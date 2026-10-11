//! LAN games (the game's src/net/lan.ts): a game hosted on this computer waits for a guest on a TCP port and answers
//! the searches of other computers on the network (UDP broadcasts); joining connects to a host. A connection carries
//! the game's messages as text, each one after its length (4 bytes, big endian); the game sends them through the
//! commands in lib.rs and hears of them through `LanEvents`. Messages go out in the order they were sent: one writer
//! thread per connection. Nothing of Tauri here (the tests run it as it is).

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The port games are hosted on (TCP) and found on (UDP): the reference's (OpenOMF's) network port.
pub const PORT: u16 = 2097;
/// Searches and answers name the game: other programs' datagrams on the port are ignored.
const GAME: &str = "omf2097r";
/// The longest message (bytes): a longer one ends the connection.
pub const MAX_MESSAGE: usize = 64 * 1024;
/// How many messages may wait for a connection's writer. A game sends a few small ones a game tick, and stops when the
/// other game stops answering: a queue this long means the other computer does not read them, and the connection is
/// dropped rather than its queue growing.
const WRITE_QUEUE: usize = 1024;
/// The most a connection may bring in a second (messages, bytes), far above what a game sends (a few small messages a
/// game tick): a computer that sends more is flooding this one (each message goes on to the game's page), and is cut off.
const FLOOD_MESSAGES: u32 = 2000;
const FLOOD_BYTES: usize = 4 * 1024 * 1024;
/// How long joining waits for the host's computer to answer.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a search listens for answers.
const SCAN_TIME: Duration = Duration::from_millis(900);
/// How often the hosting threads look whether they should stop.
const POLL: Duration = Duration::from_millis(50);
/// What a second guest hears (the game's own rejection message; the code says it in the guest's language).
const BUSY: &str = r#"{"t":"reject","reason":"That game is already being played.","code":"busy"}"#;
/// Adapters other computers do not reach this one by (their names contain these, in lower case): virtual machines' and
/// containers' (Hyper-V's and WSL's "vEthernet (...)", Docker, VirtualBox, VMware, libvirt, LXC, Podman). Windows may list
/// one of their 172.x addresses first.
const VIRTUAL_ADAPTERS: &[&str] =
  &["vethernet", "wsl", "docker", "virtualbox", "vmware", "hyper-v", "vboxnet", "vmnet", "virbr", "veth", "br-", "lxc", "podman"];

/// What the game hears: a guest joined the hosted game, a message, a connection's end.
pub trait LanEvents: Send + Sync + 'static {
  fn opened(&self, id: u32, peer: String);
  fn data(&self, id: u32, text: String);
  fn closed(&self, id: u32, reason: String);
}

/// A game found on the network.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct LanGame {
  pub name: String,
  pub address: String,
  pub port: u16,
  pub version: String,
  pub busy: bool,
}

/// This computer: a name for the player (the user's), its network addresses (to tell a friend: the likeliest first), and
/// its system ("windows", "macos", "linux": the LAN page says what the system may ask before the game can use the
/// network).
#[derive(Serialize, Clone, Debug)]
pub struct LanInfo {
  pub name: String,
  pub addresses: Vec<String>,
  pub os: &'static str,
}

/// A connection made by joining.
#[derive(Serialize, Clone, Debug)]
pub struct Joined {
  pub id: u32,
  pub peer: String,
}

struct Conn {
  /// (to cut the connection off)
  stream: TcpStream,
  /// The writer thread's queue (WRITE_QUEUE long): dropping it lets the writer send what is queued and close.
  tx: SyncSender<Vec<u8>>,
}

struct Hosting {
  stop: Arc<AtomicBool>,
  threads: Vec<JoinHandle<()>>,
}

pub struct Lan {
  events: Arc<dyn LanEvents>,
  conns: Mutex<HashMap<u32, Conn>>,
  next_id: AtomicU32,
  hosting: Mutex<Option<Hosting>>,
}

impl Lan {
  pub fn new(events: Arc<dyn LanEvents>) -> Arc<Lan> {
    Arc::new(Lan { events, conns: Mutex::new(HashMap::new()), next_id: AtomicU32::new(0), hosting: Mutex::new(None) })
  }

  /// Hosts a game under a name: guests may connect (one at a time; others are told it is busy), and searches are
  /// answered. Returns the port (the game's own, or any free one when another program has it: then it can only be
  /// joined by its address and port, and searches are not answered).
  pub fn host(self: &Arc<Self>, name: &str, version: &str) -> io::Result<u16> {
    self.unhost();
    let listener =
      TcpListener::bind((Ipv4Addr::UNSPECIFIED, PORT)).or_else(|_| TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let stop = Arc::new(AtomicBool::new(false));
    let guest = Arc::new(Mutex::new(None::<u32>));
    let mut threads = Vec::new();
    {
      let (lan, stop, guest) = (self.clone(), stop.clone(), guest.clone());
      threads.push(thread::spawn(move || lan.accept_loop(listener, &stop, &guest)));
    }
    if port == PORT {
      if let Ok(udp) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, PORT)) {
        let (lan, stop) = (self.clone(), stop.clone());
        let (name, version) = (name.to_string(), version.to_string());
        threads.push(thread::spawn(move || {
          let busy = || guest.lock().unwrap().is_some_and(|id| lan.is_open(id));
          answer_searches(&udp, &stop, &name, &version, port, busy);
        }));
      }
    }
    *self.hosting.lock().unwrap() = Some(Hosting { stop, threads });
    Ok(port)
  }

  /// Stops hosting (a guest already connected stays connected).
  pub fn unhost(&self) {
    let hosting = self.hosting.lock().unwrap().take();
    if let Some(h) = hosting {
      h.stop.store(true, Ordering::Relaxed);
      for t in h.threads {
        let _ = t.join();
      }
    }
  }

  fn accept_loop(self: Arc<Self>, listener: TcpListener, stop: &AtomicBool, guest: &Mutex<Option<u32>>) {
    while !stop.load(Ordering::Relaxed) {
      let Ok((stream, peer)) = listener.accept() else {
        thread::sleep(POLL);
        continue;
      };
      // (Windows hands out the accepted connection non-blocking, like the listener)
      let _ = stream.set_nonblocking(false);
      let mut g = guest.lock().unwrap();
      if g.is_some_and(|id| self.is_open(id)) {
        refuse(stream);
        continue;
      }
      if let Ok(id) = self.open(stream, peer, true) {
        *g = Some(id);
      }
    }
  }

  fn is_open(&self, id: u32) -> bool {
    self.conns.lock().unwrap().contains_key(&id)
  }

  /// Joins the game hosted at an address ("192.168.1.20", "192.168.1.20:2097" or a computer's name).
  pub fn join(self: &Arc<Self>, address: &str) -> io::Result<Joined> {
    let addr = resolve(address)?;
    let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)?;
    let id = self.open(stream, addr, false)?;
    Ok(Joined { id, peer: addr.ip().to_string() })
  }

  fn open(self: &Arc<Self>, stream: TcpStream, peer: SocketAddr, announce: bool) -> io::Result<u32> {
    // (each message as soon as it is written: the game sends a few small ones per game tick)
    stream.set_nodelay(true)?;
    let reader = stream.try_clone()?;
    let writer = stream.try_clone()?;
    let (tx, rx) = mpsc::sync_channel(WRITE_QUEUE);
    let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    self.conns.lock().unwrap().insert(id, Conn { stream, tx });
    // (before its messages)
    if announce {
      self.events.opened(id, peer.ip().to_string());
    }
    thread::spawn(move || write_loop(writer, &rx));
    let lan = self.clone();
    thread::spawn(move || lan.read_loop(id, reader));
    Ok(id)
  }

  fn read_loop(self: Arc<Self>, id: u32, mut stream: TcpStream) {
    let mut flood = Flood::new();
    let reason = loop {
      match read_message(&mut stream) {
        Ok(text) if flood.too_much(text.len()) => break "the other game sent too much".to_string(),
        Ok(text) => self.events.data(id, text),
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break "closed".to_string(),
        Err(e) => break e.to_string(),
      }
    };
    let gone = self.conns.lock().unwrap().remove(&id);
    if let Some(c) = gone {
      let _ = c.stream.shutdown(Shutdown::Both);
    }
    self.events.closed(id, reason);
  }

  /// Sends messages on a connection (queued for its writer, in order). A queue that is full (the other computer does
  /// not read what this one sends) drops the connection: the game hears it closed.
  pub fn send(&self, id: u32, texts: Vec<String>) -> Result<(), String> {
    let mut conns = self.conns.lock().unwrap();
    let c = conns.get(&id).ok_or("not connected")?;
    let mut full = false;
    for text in texts {
      if text.len() > MAX_MESSAGE {
        return Err("message too long".into());
      }
      match c.tx.try_send(frame(&text)) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) => {
          full = true;
          break;
        }
        Err(TrySendError::Disconnected(_)) => return Err("not connected".into()),
      }
    }
    if full {
      // (its reader then ends, and says so)
      if let Some(c) = conns.remove(&id) {
        let _ = c.stream.shutdown(Shutdown::Both);
      }
      return Err("the other game does not read what this one sends".into());
    }
    Ok(())
  }

  /// Closes a connection: what was sent goes out first.
  pub fn close(&self, id: u32) {
    let gone = self.conns.lock().unwrap().remove(&id);
    if let Some(c) = gone {
      drop(c.tx);
      // (a writer stuck on a computer that stopped reading is cut off after a moment)
      let stream = c.stream;
      thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        let _ = stream.shutdown(Shutdown::Both);
      });
    }
  }
}

fn frame(text: &str) -> Vec<u8> {
  let mut f = Vec::with_capacity(4 + text.len());
  f.extend_from_slice(&(text.len() as u32).to_be_bytes());
  f.extend_from_slice(text.as_bytes());
  f
}

/// What a connection has brought in the last second (FLOOD_MESSAGES, FLOOD_BYTES).
struct Flood {
  since: Instant,
  messages: u32,
  bytes: usize,
}

impl Flood {
  fn new() -> Flood {
    Flood { since: Instant::now(), messages: 0, bytes: 0 }
  }

  /// A message of `len` bytes came in: whether the connection now brings too much.
  fn too_much(&mut self, len: usize) -> bool {
    if self.since.elapsed() >= Duration::from_secs(1) {
      *self = Flood::new();
    }
    self.messages += 1;
    self.bytes += len;
    self.messages > FLOOD_MESSAGES || self.bytes > FLOOD_BYTES
  }
}

fn read_message(stream: &mut TcpStream) -> io::Result<String> {
  let mut len = [0u8; 4];
  stream.read_exact(&mut len)?;
  let n = u32::from_be_bytes(len) as usize;
  if n > MAX_MESSAGE {
    return Err(io::Error::new(io::ErrorKind::InvalidData, "message too long"));
  }
  let mut buf = vec![0u8; n];
  stream.read_exact(&mut buf)?;
  String::from_utf8(buf).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "not text"))
}

fn write_loop(mut stream: TcpStream, rx: &Receiver<Vec<u8>>) {
  for f in rx {
    if stream.write_all(&f).is_err() {
      break;
    }
  }
  let _ = stream.shutdown(Shutdown::Both);
}

/// Tells a guest the game is taken, and closes.
fn refuse(mut stream: TcpStream) {
  let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
  let _ = stream.write_all(&frame(BUSY));
  let _ = stream.shutdown(Shutdown::Both);
}

fn resolve(address: &str) -> io::Result<SocketAddr> {
  let a = address.trim();
  if let Ok(s) = a.parse::<SocketAddr>() {
    return Ok(s);
  }
  if let Ok(ip) = a.parse::<IpAddr>() {
    return Ok(SocketAddr::new(ip, PORT));
  }
  // A computer's name, with or without a port.
  let found: Vec<SocketAddr> = if a.contains(':') { a.to_socket_addrs()?.collect() } else { (a, PORT).to_socket_addrs()?.collect() };
  found
    .iter()
    .find(|s| s.is_ipv4())
    .or(found.first())
    .copied()
    .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no computer by that name"))
}

fn is_search(datagram: &[u8]) -> bool {
  serde_json::from_slice::<serde_json::Value>(datagram)
    .is_ok_and(|v| v["t"] == "find" && v["game"] == GAME)
}

/// Answers searches until told to stop.
fn answer_searches(udp: &UdpSocket, stop: &AtomicBool, name: &str, version: &str, port: u16, busy: impl Fn() -> bool) {
  let _ = udp.set_read_timeout(Some(Duration::from_millis(200)));
  let mut buf = [0u8; 512];
  while !stop.load(Ordering::Relaxed) {
    let (n, from) = match udp.recv_from(&mut buf) {
      Ok(r) => r,
      Err(e) => {
        // (Windows reports an earlier answer's unreachable port here: carry on)
        if !matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) {
          thread::sleep(POLL);
        }
        continue;
      }
    };
    if !is_search(&buf[..n]) {
      continue;
    }
    let answer = serde_json::json!({
      "t": "here", "game": GAME, "name": name, "port": port, "version": version, "busy": busy(),
    });
    let _ = udp.send_to(answer.to_string().as_bytes(), from);
  }
}

fn read_answer(datagram: &[u8], from: SocketAddr) -> Option<LanGame> {
  let v: serde_json::Value = serde_json::from_slice(datagram).ok()?;
  if v["t"] != "here" || v["game"] != GAME {
    return None;
  }
  let text = |k: &str, max: usize| v[k].as_str().map(|s| s.chars().filter(|c| !c.is_control()).take(max).collect::<String>());
  Some(LanGame {
    name: text("name", 24)?,
    address: from.ip().to_string(),
    port: u16::try_from(v["port"].as_u64()?).ok()?,
    version: text("version", 24)?,
    busy: v["busy"].as_bool().unwrap_or(false),
  })
}

/// The network adapters' IPv4 addresses and broadcast addresses (up, not loopback or self-assigned), the likeliest one
/// for other computers to reach this one by first (address_rank).
fn adapters() -> Vec<(Ipv4Addr, Ipv4Addr)> {
  let mut out = Vec::new();
  for i in if_addrs::get_if_addrs().unwrap_or_default() {
    if i.is_loopback() || i.is_link_local() || !i.is_oper_up() {
      continue;
    }
    if let if_addrs::IfAddr::V4(a) = &i.addr {
      let broadcast = a.broadcast.unwrap_or_else(|| Ipv4Addr::from(u32::from(a.ip) | !u32::from(a.netmask)));
      out.push((address_rank(&i.name, i.is_p2p(), a.ip), a.ip, broadcast));
    }
  }
  // (a stable sort: the system's order among equals)
  out.sort_by_key(|(rank, ..)| *rank);
  out.into_iter().map(|(_, ip, broadcast)| (ip, broadcast)).collect()
}

/// How likely an adapter's address is the one other computers reach this one by (lower first): a home network's
/// (192.168.x.x and 10.x.x.x, then 172.16-31.x.x, which virtual machines' networks often use), then any other; and all
/// of them before those of virtual adapters and tunnels (VPNs).
fn address_rank(adapter: &str, tunnel: bool, ip: Ipv4Addr) -> u8 {
  let name = adapter.to_lowercase();
  let virtual_adapter = tunnel || VIRTUAL_ADAPTERS.iter().any(|v| name.contains(v));
  let [a, b, ..] = ip.octets();
  let rank = if a == 192 && b == 168 || a == 10 {
    0
  } else if ip.is_private() {
    1
  } else {
    2
  };
  if virtual_adapter {
    rank + 3
  } else {
    rank
  }
}

/// Looks for games on the network for a moment: asks every adapter's broadcast address (and this computer).
pub fn scan() -> io::Result<Vec<LanGame>> {
  let udp = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
  udp.set_broadcast(true)?;
  let search = serde_json::json!({ "t": "find", "game": GAME }).to_string();
  let own = adapters();
  let mut targets = vec![Ipv4Addr::BROADCAST, Ipv4Addr::LOCALHOST];
  for (_, b) in &own {
    if !targets.contains(b) {
      targets.push(*b);
    }
  }
  let start = Instant::now();
  let mut asked = 0u32;
  // (whether a search went out on the network, past this computer; else why not)
  let mut sent = false;
  let mut failed: Option<io::Error> = None;
  let mut games: Vec<LanGame> = Vec::new();
  let mut buf = [0u8; 1024];
  while start.elapsed() < SCAN_TIME {
    // (asked twice: a datagram can be lost)
    if asked < 2 && start.elapsed() >= Duration::from_millis(300 * u64::from(asked)) {
      for t in &targets {
        match udp.send_to(search.as_bytes(), (*t, PORT)) {
          Ok(_) => sent |= !t.is_loopback(),
          Err(e) => failed = Some(e),
        }
      }
      asked += 1;
    }
    udp.set_read_timeout(Some(Duration::from_millis(50)))?;
    if let Ok((n, from)) = udp.recv_from(&mut buf) {
      if let Some(g) = read_answer(&buf[..n], from) {
        if !games.iter().any(|x| x.address == g.address && x.port == g.port) {
          games.push(g);
        }
      }
    }
  }
  // A game on this computer answers from the loopback address and from its network addresses: listed once.
  let mine = |g: &LanGame| g.address == "127.0.0.1" || own.iter().any(|(ip, _)| ip.to_string() == g.address);
  let mut out: Vec<LanGame> = Vec::new();
  for g in games {
    if mine(&g) {
      if let Some(i) = out.iter().position(|x| mine(x) && x.port == g.port) {
        // (its network address rather than the loopback one)
        if out[i].address == "127.0.0.1" {
          out[i] = g;
        }
        continue;
      }
    }
    out.push(g);
  }
  // Not one search went out on the network: there is none, or the system does not let the game use it (macOS asks for
  // the local network first). The game says so, rather than that it found no games (one on this computer still shows).
  if !sent && out.is_empty() {
    return Err(failed.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "no network")));
  }
  Ok(out)
}

/// This computer's user name, network addresses and system.
pub fn info() -> LanInfo {
  let name = ["USERNAME", "USER", "COMPUTERNAME", "HOSTNAME"]
    .iter()
    .filter_map(|k| std::env::var(k).ok())
    .find(|s| !s.trim().is_empty())
    .unwrap_or_default();
  LanInfo { name, addresses: adapters().iter().map(|(ip, _)| ip.to_string()).collect(), os: std::env::consts::OS }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::mpsc::{RecvTimeoutError, Sender};

  /// Records what the game would hear.
  struct Heard(Mutex<Sender<(String, u32, String)>>);
  impl LanEvents for Heard {
    fn opened(&self, id: u32, peer: String) {
      let _ = self.0.lock().unwrap().send(("open".into(), id, peer));
    }
    fn data(&self, id: u32, text: String) {
      let _ = self.0.lock().unwrap().send(("data".into(), id, text));
    }
    fn closed(&self, id: u32, reason: String) {
      let _ = self.0.lock().unwrap().send(("close".into(), id, reason));
    }
  }

  fn lan() -> (Arc<Lan>, Receiver<(String, u32, String)>) {
    let (tx, rx) = mpsc::channel();
    (Lan::new(Arc::new(Heard(Mutex::new(tx)))), rx)
  }

  fn next(rx: &Receiver<(String, u32, String)>) -> (String, u32, String) {
    match rx.recv_timeout(Duration::from_secs(5)) {
      Ok(e) => e,
      Err(RecvTimeoutError::Timeout) => panic!("nothing heard"),
      Err(e) => panic!("{e}"),
    }
  }

  #[test]
  fn host_found_joined_and_messages_in_order() {
    let (host, host_heard) = lan();
    let (guest, guest_heard) = lan();
    let port = host.host("JARED", "0.3.0").unwrap();
    assert_eq!(port, PORT);
    let found = scan().unwrap();
    let game = found.iter().find(|g| g.port == PORT).expect("the hosted game is found");
    assert_eq!(game.name, "JARED");
    assert_eq!(game.version, "0.3.0");
    assert!(!game.busy);

    let joined = guest.join("127.0.0.1").unwrap();
    let (kind, host_id, _) = next(&host_heard);
    assert_eq!(kind, "open");
    // Many messages, both ways, arrive in order.
    let texts: Vec<String> = (0..2000).map(|i| format!(r#"{{"t":"in","s":{i}}}"#)).collect();
    for chunk in texts.chunks(7) {
      guest.send(joined.id, chunk.to_vec()).unwrap();
    }
    for t in &texts {
      assert_eq!(next(&host_heard), ("data".into(), host_id, t.clone()));
    }
    host.send(host_id, vec!["welcome".into(), "x".repeat(MAX_MESSAGE)]).unwrap();
    assert_eq!(next(&guest_heard).2, "welcome");
    assert_eq!(next(&guest_heard).2.len(), MAX_MESSAGE);
    assert!(host.send(host_id, vec!["x".repeat(MAX_MESSAGE + 1)]).is_err());

    // A second guest is turned away while the first plays (and the game shows as taken).
    assert!(scan().unwrap().iter().any(|g| g.port == PORT && g.busy));
    let (other, other_heard) = lan();
    let second = other.join(&format!("127.0.0.1:{PORT}")).unwrap();
    let (kind, id, text) = next(&other_heard);
    assert_eq!((kind.as_str(), id), ("data", second.id));
    assert!(text.contains("reject"));
    assert_eq!(next(&other_heard).0, "close");

    // Closing: the last message goes out first, then the other side hears the end.
    guest.send(joined.id, vec!["bye".into()]).unwrap();
    guest.close(joined.id);
    assert_eq!(next(&host_heard), ("data".into(), host_id, "bye".into()));
    assert_eq!(next(&host_heard).0, "close");
    assert!(host.send(host_id, vec!["late".into()]).is_err());

    host.unhost();
    assert!(!scan().unwrap().iter().any(|g| g.port == PORT));
    assert!(guest.join("127.0.0.1").is_err());
  }

  #[test]
  fn addresses() {
    assert_eq!(resolve("192.168.1.20").unwrap(), "192.168.1.20:2097".parse().unwrap());
    assert_eq!(resolve(" 10.0.0.5:4000 ").unwrap(), "10.0.0.5:4000".parse().unwrap());
    assert_eq!(resolve("localhost").unwrap().port(), PORT);
    assert!(is_search(br#"{"t":"find","game":"omf2097r"}"#));
    assert!(!is_search(br#"{"t":"find","game":"other"}"#));
    assert!(!is_search(b"\xff\x00"));
    let from: SocketAddr = "192.168.1.9:2097".parse().unwrap();
    let g = read_answer(br#"{"t":"here","game":"omf2097r","name":"A\u0007B","port":2097,"version":"1","busy":true}"#, from).unwrap();
    assert_eq!((g.name.as_str(), g.address.as_str(), g.busy), ("AB", "192.168.1.9", true));
    assert!(read_answer(br#"{"t":"here","game":"omf2097r","name":"A","port":99999,"version":"1"}"#, from).is_none());
  }

  #[test]
  fn the_address_to_tell_a_friend_comes_first() {
    let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
    // (Windows with WSL or Hyper-V lists its vEthernet adapter's 172.x address first)
    let mut found = [
      ("vEthernet (WSL (Hyper-V firewall))", false, ip("172.27.48.1")),
      ("VirtualBox Host-Only Network", false, ip("192.168.56.1")),
      ("Ethernet 2", false, ip("172.20.1.5")),
      ("Wi-Fi", false, ip("192.168.1.20")),
      ("WireGuard", true, ip("10.8.0.2")),
      ("docker0", false, ip("172.17.0.1")),
      ("eth1", false, ip("84.12.1.2")),
    ];
    found.sort_by_key(|(name, tunnel, ip)| address_rank(name, *tunnel, *ip));
    let names: Vec<&str> = found.iter().map(|(name, ..)| *name).collect();
    assert_eq!(names[..3], ["Wi-Fi", "Ethernet 2", "eth1"]);
    assert!(address_rank("en0", false, ip("10.0.0.7")) < address_rank("Ethernet", false, ip("172.16.0.7")));
    assert!(BUSY.contains(r#""code":"busy""#));
  }

  #[test]
  fn a_connection_that_floods_is_cut_off() {
    let mut f = Flood::new();
    for _ in 0..FLOOD_MESSAGES {
      assert!(!f.too_much(60));
    }
    assert!(f.too_much(60));
    assert!(Flood::new().too_much(FLOOD_BYTES + 1));
  }
}
