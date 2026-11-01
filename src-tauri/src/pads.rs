//! Gamepads on Linux, read by the shell itself (the game's src/controller/nativePads.ts): WebKitGTK's Gamepad API
//! sees only the pads its libmanette has a mapping for, and none where it was built without gamepads, so PlayStation
//! pads and others went unseen. gilrs reads them from evdev, with SDL's mappings (and Steam's, from
//! SDL_GAMECONTROLLERCONFIG); their state goes to the game in the browser's standard layout through `PadEvents`, and
//! the game's rumble comes back through `rumble`. On Windows and macOS the windows' own Gamepad API reads the pads, and
//! `start` says so. Nothing of Tauri here.

use std::collections::HashSet;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
#[cfg(target_os = "linux")]
use std::time::{Duration, Instant};

use serde::Serialize;

/// The shortest time between two state messages: a stick being moved changes every few milliseconds (at most about 250
/// messages a second; the game reads the pads once a frame).
#[cfg(target_os = "linux")]
const SEND_EVERY: Duration = Duration::from_millis(4);
/// How long the pad thread waits for the pads before it looks at the game's requests (rumble) again.
#[cfg(target_os = "linux")]
const WAIT: Duration = Duration::from_millis(10);
/// An analog trigger counts as pressed from this far in, and as released below the second: about where browsers have it
/// (gilrs's own is three quarters of the way).
#[cfg(target_os = "linux")]
const TRIGGER_PRESSED: f32 = 0.15;
#[cfg(target_os = "linux")]
const TRIGGER_RELEASED: f32 = 0.1;

/// A pad's state in the browser's standard layout (src/controller/input.ts, PadButton): buttons 0-16 are A, B, X, Y (by
/// place: bottom, right, left, top), LB, RB, LT, RT, View, Menu, the sticks' clicks, the d-pad's up, down, left and
/// right, and the guide button; axes 0-3 are the left stick's x and y and the right stick's (right and down positive).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub struct PadState {
  /// gilrs's number for the pad (a pad that comes back gets its number again).
  pub number: usize,
  pub name: String,
  pub vendor: Option<u16>,
  pub product: Option<u16>,
  /// How far each button is in, 0 to 1 (only the triggers are in between).
  pub buttons: Vec<f32>,
  /// The buttons that count as pressed (bit i: button i).
  pub pressed: u32,
  pub axes: [f32; 4],
}

/// What the game hears: the connected pads' state, after any of them changed.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub trait PadEvents: Send + Sync + 'static {
  fn state(&self, pads: &[PadState]);
}

/// What the game asks of the pad thread.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
enum Request {
  /// Send the pads' state (a page started listening).
  State,
  /// Rumble a pad (its number) for `ms` milliseconds; the strengths are 0 to 1.
  Rumble { number: usize, strong: f32, weak: f32, ms: u32 },
}

pub struct Pads {
  events: Arc<dyn PadEvents>,
  /// The pad thread's requests, and whether it reads the pads (None: not started yet).
  thread: Mutex<Option<(Sender<Request>, bool)>>,
}

impl Pads {
  pub fn new(events: Arc<dyn PadEvents>) -> Arc<Pads> {
    Arc::new(Pads { events, thread: Mutex::new(None) })
  }

  /// Starts reading the pads (the first time) and sends their state, for a page that started listening. False when
  /// the pads are not read here (not Linux, or gilrs could not start): the page reads them itself.
  pub fn start(&self) -> bool {
    let mut thread = self.thread.lock().unwrap();
    let (requests, on) = thread.get_or_insert_with(|| spawn(self.events.clone()));
    if *on {
      let _ = requests.send(Request::State);
    }
    *on
  }

  /// Rumbles a pad (its number in `PadState`) for `ms` milliseconds; a pad's rumble replaces the one it was playing,
  /// as a browser's does.
  pub fn rumble(&self, number: usize, strong: f32, weak: f32, ms: u32) {
    if let Some((requests, true)) = self.thread.lock().unwrap().as_ref() {
      let _ = requests.send(Request::Rumble { number, strong, weak, ms });
    }
  }
}

/// Starts the pad thread; whether it reads the pads.
#[cfg(target_os = "linux")]
fn spawn(events: Arc<dyn PadEvents>) -> (Sender<Request>, bool) {
  let (requests, rx) = mpsc::channel();
  let (ready, started) = mpsc::sync_channel(1);
  let spawned = std::thread::Builder::new().name("pads".into()).spawn(move || reader::run(events, rx, ready));
  let on = spawned.is_ok() && started.recv().unwrap_or(false);
  (requests, on)
}

#[cfg(not(target_os = "linux"))]
fn spawn(_events: Arc<dyn PadEvents>) -> (Sender<Request>, bool) {
  (mpsc::channel().0, false)
}

/// Steam's virtual pads (Steam Input's, which a game Steam starts plays with): USB vendor and product.
const STEAM_VIRTUAL_PAD: (u16, u16) = (0x28de, 0x11ff);

/// The pads to leave out, as SDL's games do (SDL_ShouldIgnoreGameController). A game Steam starts plays with Steam
/// Input's virtual pads: Steam names the pads it reads for them in SDL_GAMECONTROLLER_IGNORE_DEVICES (each would count
/// twice), and says the game may take its virtual pads with SDL_GAMECONTROLLER_ALLOW_STEAM_VIRTUAL_GAMEPAD; elsewhere
/// they are another game's, the same pads again. With SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT only the pads named
/// there count.
#[derive(Default, Debug)]
struct Ignored {
  ignore: HashSet<(u16, u16)>,
  only: Option<HashSet<(u16, u16)>>,
  steam_pads: bool,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
impl Ignored {
  fn from_env() -> Ignored {
    let hint = |name: &str| std::env::var(name).ok();
    let list = |name: &str| hint(name).map(|v| device_list(&hint_value(&v)));
    Ignored {
      ignore: list("SDL_GAMECONTROLLER_IGNORE_DEVICES").unwrap_or_default(),
      only: list("SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT").filter(|l| !l.is_empty()),
      steam_pads: hint("SDL_GAMECONTROLLER_ALLOW_STEAM_VIRTUAL_GAMEPAD").is_some_and(|v| hint_true(&v)),
    }
  }

  /// Whether a pad (its USB vendor and product; unknown ones count as 0) is left out.
  fn ignores(&self, vendor: Option<u16>, product: Option<u16>) -> bool {
    let pad = (vendor.unwrap_or(0), product.unwrap_or(0));
    if pad == STEAM_VIRTUAL_PAD {
      return !self.steam_pads;
    }
    match &self.only {
      Some(only) => !only.contains(&pad),
      None => self.ignore.contains(&pad),
    }
  }
}

/// An SDL hint's value: the text, or with "@path" the file's.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn hint_value(value: &str) -> String {
  match value.strip_prefix('@') {
    Some(path) => std::fs::read_to_string(path).unwrap_or_default(),
    None => value.to_string(),
  }
}

/// An SDL hint as a yes or no: "0" and "false" are no, any other text yes (none: no).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn hint_true(value: &str) -> bool {
  !(value.is_empty() || value.starts_with('0') || value.eq_ignore_ascii_case("false"))
}

/// SDL's list of pads, "0x054c/0x0ce6,0x28de/0x1205", read as SDL reads it: the numbers written with "0x" (in
/// hexadecimal; 16 bits), two by two, whatever is between them.
fn device_list(value: &str) -> HashSet<(u16, u16)> {
  let numbers: Vec<u16> = value
    .split("0x")
    .skip(1)
    .map(|rest| rest.chars().map_while(|c| c.to_digit(16)).fold(0u16, |n, d| n.wrapping_mul(16).wrapping_add(d as u16)))
    .collect();
  numbers.as_chunks::<2>().0.iter().map(|&[vendor, product]| (vendor, product)).collect()
}

#[cfg(target_os = "linux")]
mod reader {
  use std::collections::hash_map::{Entry, HashMap};
  use std::sync::mpsc::{Receiver, SyncSender, TryRecvError};

  use gilrs::ev::filter::{axis_dpad_to_button, deadzone, Filter, Jitter};
  use gilrs::ff::{BaseEffect, BaseEffectType, Effect, EffectBuilder, Repeat, Ticks};
  use gilrs::{Axis, Button, EventType, Gilrs, GilrsBuilder};

  use super::*;

  /// The standard layout's buttons, in its order (gilrs names the face buttons by place, as the layout does).
  const STANDARD_BUTTONS: [Button; 17] = [
    Button::South,
    Button::East,
    Button::West,
    Button::North,
    Button::LeftTrigger,
    Button::RightTrigger,
    Button::LeftTrigger2,
    Button::RightTrigger2,
    Button::Select,
    Button::Start,
    Button::LeftThumb,
    Button::RightThumb,
    Button::DPadUp,
    Button::DPadDown,
    Button::DPadLeft,
    Button::DPadRight,
    Button::Mode,
  ];

  /// The pad thread: reads the pads' events, sends their state after a change (no more often than SEND_EVERY), and
  /// plays the rumble the game asks for. Says on `ready` whether gilrs started; ends when the game's side is gone.
  pub(super) fn run(events: Arc<dyn PadEvents>, requests: Receiver<Request>, ready: SyncSender<bool>) {
    // (gilrs's own filters and state updates are done below: its next_event_blocking would go on waiting through the
    // events its filters drop, a resting stick's jitter among them, and hold back a change or a rumble)
    let built = GilrsBuilder::new()
      .with_default_filters(false)
      .set_update_state(false)
      .set_axis_to_btn(TRIGGER_PRESSED, TRIGGER_RELEASED)
      .build();
    let mut gilrs = match built {
      Ok(gilrs) => gilrs,
      Err(e) => {
        eprintln!("Gamepads can't be read: {e}");
        let _ = ready.send(false);
        return;
      }
    };
    let _ = ready.send(true);
    let _no_pads_after = NoPadsAfter(events.clone());
    let ignored = Ignored::from_env();
    let jitter = Jitter::new();
    // (the pads' motors, once they rumbled: dropping them when a pad goes ends its effects)
    let mut rumbles = HashMap::<usize, Motors>::new();
    let mut changed = false;
    let mut sent: Option<Instant> = None;
    loop {
      let since = sent.map_or(SEND_EVERY, |t| t.elapsed());
      // (a change waits for the rest of SEND_EVERY at most)
      let wait = if changed { SEND_EVERY.saturating_sub(since) } else { WAIT };
      let mut next = gilrs.next_event_blocking(Some(wait));
      while let Some(raw) = next {
        // (gilrs's default filters, as its next_event has them: a hat's d-pad as buttons, a stick's jitter and its dead
        // zone dropped)
        let event = Some(raw)
          .filter_ev(&axis_dpad_to_button, &mut gilrs)
          .filter_ev(&jitter, &mut gilrs)
          .filter_ev(&deadzone, &mut gilrs);
        if let Some(e) = event.filter(|e| !e.is_dropped()) {
          gilrs.update(&e);
          match e.event {
            EventType::ForceFeedbackEffectCompleted => (),
            EventType::Disconnected => {
              rumbles.remove(&usize::from(e.id));
              changed = true;
            }
            _ => changed = true,
          }
        }
        next = gilrs.next_event();
      }
      loop {
        match requests.try_recv() {
          Ok(Request::State) => changed = true,
          Ok(Request::Rumble { number, strong, weak, ms }) => {
            rumble(&mut gilrs, &mut rumbles, number, strong, weak, ms)
          }
          Err(TryRecvError::Empty) => break,
          Err(TryRecvError::Disconnected) => return,
        }
      }
      if changed && sent.is_none_or(|t| t.elapsed() >= SEND_EVERY) {
        events.state(&state(&gilrs, &ignored));
        sent = Some(Instant::now());
        changed = false;
      }
    }
  }

  /// The game hears of no pads once the pad thread ends, a panic in gilrs too: their last state would hold its buttons
  /// down.
  struct NoPadsAfter(Arc<dyn PadEvents>);

  impl Drop for NoPadsAfter {
    fn drop(&mut self) {
      self.0.state(&[]);
    }
  }

  /// The connected pads that count, in the standard layout.
  fn state(gilrs: &Gilrs, ignored: &Ignored) -> Vec<PadState> {
    gilrs
      .gamepads()
      .filter(|(_, pad)| !ignored.ignores(pad.vendor_id(), pad.product_id()))
      .map(|(id, pad)| {
        let mut pressed = 0;
        let buttons = STANDARD_BUTTONS
          .iter()
          .enumerate()
          .map(|(i, &button)| {
            let down = pad.is_pressed(button);
            if down {
              pressed |= 1 << i;
            }
            let full = if down { 1.0 } else { 0.0 };
            match button {
              // (an analog trigger's own value; one reported as a button has none)
              Button::LeftTrigger2 | Button::RightTrigger2 => pad.button_data(button).map_or(full, |d| d.value()),
              _ => full,
            }
          })
          .collect();
        PadState {
          number: id.into(),
          name: pad.name().to_string(),
          vendor: pad.vendor_id(),
          product: pad.product_id(),
          buttons,
          pressed,
          // (gilrs has up positive; 0 - y, so a centered stick is 0, not -0)
          axes: [
            pad.value(Axis::LeftStickX),
            0.0 - pad.value(Axis::LeftStickY),
            pad.value(Axis::RightStickX),
            0.0 - pad.value(Axis::RightStickY),
          ],
        }
      })
      .collect()
  }

  /// A pad's rumble: an effect for each of its motors, on at full strength while it plays. Each rumble sets their
  /// strength (gain) and how long they play, then plays them again: gilrs keeps its effects in slots it never reuses,
  /// so new ones for each rumble (the game asks for one each tick of a screen shake) would pile up.
  struct Motors {
    strong: Effect,
    weak: Effect,
  }

  /// gilrs plays rumble in steps of this long (its TICK_DURATION).
  const RUMBLE_STEP: u32 = 50;

  /// Plays a rumble on a pad that has one, in place of the one it was playing.
  fn rumble(gilrs: &mut Gilrs, rumbles: &mut HashMap<usize, Motors>, number: usize, strong: f32, weak: f32, ms: u32) {
    let motors = match rumbles.entry(number) {
      Entry::Occupied(motors) => motors.into_mut(),
      Entry::Vacant(place) => {
        let pad = gilrs.gamepads().find(|(id, pad)| usize::from(*id) == number && pad.is_ff_supported());
        let Some((id, _)) = pad else {
          return;
        };
        let motor = |kind, gilrs: &mut Gilrs| {
          EffectBuilder::new().add_effect(BaseEffect { kind, ..Default::default() }).gamepads(&[id]).finish(gilrs)
        };
        let Ok(strong) = motor(BaseEffectType::Strong { magnitude: u16::MAX }, gilrs) else { return };
        let Ok(weak) = motor(BaseEffectType::Weak { magnitude: u16::MAX }, gilrs) else { return };
        place.insert(Motors { strong, weak })
      }
    };
    // (an effect plays for its repeat's length and two steps more: the rumble's length in steps, two at least)
    let steps = (ms.saturating_add(RUMBLE_STEP / 2) / RUMBLE_STEP).max(2);
    let length = Repeat::For(Ticks::from_ms((steps - 2) * RUMBLE_STEP));
    for (effect, gain) in [(&motors.strong, strong), (&motors.weak, weak)] {
      let _ = effect.set_gain(gain.clamp(0.0, 1.0));
      let _ = effect.set_repeat(length);
      let _ = effect.play();
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_sdls_device_lists() {
    let list = device_list("0x054c/0x0ce6, 0x28DE/0x1205,bad,0x045e/");
    assert_eq!(list, HashSet::from([(0x054c, 0x0ce6), (0x28de, 0x1205)]));
    // (as SDL: only numbers written with 0x, two by two, whatever is between them)
    assert_eq!(device_list("1356/3302 0X054C/0X0CE6"), HashSet::new());
    assert_eq!(device_list("0x057e 0x2009;0x0001,0x0002"), HashSet::from([(0x057e, 0x2009), (1, 2)]));
    assert!(device_list("").is_empty());
  }

  #[test]
  fn leaves_out_the_pads_steam_reads_and_its_virtual_pads_elsewhere() {
    let steam = Ignored { ignore: device_list("0x054c/0x0ce6,0x28de/0x1205"), only: None, steam_pads: true };
    assert!(steam.ignores(Some(0x054c), Some(0x0ce6)));
    assert!(!steam.ignores(Some(0x28de), Some(0x11ff)));
    assert!(!steam.ignores(Some(0x045e), Some(0x0b12)));
    assert!(!steam.ignores(None, None));
    // (not started by Steam: its virtual pads are another game's)
    assert!(Ignored::default().ignores(Some(0x28de), Some(0x11ff)));
    assert!(!Ignored::default().ignores(Some(0x054c), Some(0x0ce6)));
    let only = Ignored { ignore: HashSet::new(), only: Some(device_list("0x045e/0x0b13")), steam_pads: true };
    assert!(!only.ignores(Some(0x045e), Some(0x0b13)));
    assert!(only.ignores(Some(0x054c), Some(0x0ce6)));
    assert!(!only.ignores(Some(0x28de), Some(0x11ff)));
  }

  #[test]
  fn reads_sdls_yes_and_no() {
    for yes in ["1", "true", "yes", "TRUE"] {
      assert!(hint_true(yes), "{yes}");
    }
    for no in ["0", "false", "FALSE", ""] {
      assert!(!hint_true(no), "{no}");
    }
  }

  #[test]
  fn reads_a_hint_from_its_file() {
    let path = std::env::temp_dir().join(format!("omf-pads-hint-{}.txt", std::process::id()));
    std::fs::write(&path, "0x057e/0x2009\n").unwrap();
    let value = hint_value(&format!("@{}", path.display()));
    let _ = std::fs::remove_file(&path);
    assert_eq!(device_list(&value), HashSet::from([(0x057e, 0x2009)]));
    assert_eq!(hint_value("0x1/0x2"), "0x1/0x2");
  }

  #[cfg(not(target_os = "linux"))]
  #[test]
  fn leaves_the_pads_to_the_window_elsewhere() {
    struct Silent;
    impl PadEvents for Silent {
      fn state(&self, _: &[PadState]) {}
    }
    let pads = Pads::new(Arc::new(Silent));
    assert!(!pads.start());
    assert!(!pads.start());
    pads.rumble(0, 1.0, 1.0, 100);
  }

  #[test]
  fn serializes_for_the_game() {
    let state = PadState {
      number: 3,
      name: "PS5 Controller".into(),
      vendor: Some(0x054c),
      product: None,
      buttons: vec![1.0, 0.0],
      pressed: 1,
      axes: [0.5, -1.0, 0.0, 0.0],
    };
    assert_eq!(
      serde_json::to_string(&state).unwrap(),
      r#"{"number":3,"name":"PS5 Controller","vendor":1356,"product":null,"buttons":[1.0,0.0],"pressed":1,"axes":[0.5,-1.0,0.0,0.0]}"#
    );
  }
}
