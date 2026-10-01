/**
 * Topic graph — pure data + derived views (Creative Intelligence OS §O).
 *
 * symptom ↔ part ↔ service ↔ system ↔ season ↔ Cleveland condition, with a
 * `why` on every edge so a consumer can show its reasoning instead of a bare
 * link. Seeded from mechanic knowledge, not from analytics: it is the MAP the
 * demand signals (customer language, GSC, declined work) are laid over, and it
 * must never pretend to be one of those signals.
 *
 * TWO HARD RULES.
 *   1. Every `path` is a registry route from shared/routes.ts — never a guess.
 *      shared/topicGraph.test.ts asserts each one exists AND is not a 301
 *      alias, because a redirected path is exactly what an internal-link
 *      recommender would otherwise emit for months while looking fine.
 *   2. No network, no DB, no server imports. shared/ is loaded by the client
 *      bundle too.
 *
 * SYMPTOM_PATTERNS is the one customer-vocabulary bank in the repo: the
 * customer-language miner (server/services/customerLanguageMiner.ts) extracts
 * with it and maps back with `symptomForPhrase`, so the phrase a customer
 * actually used and the graph node it lands on cannot drift apart. ORDER
 * MATTERS — the first pattern that claims a span wins, so the specific
 * ("shakes when I brake") sits above the general ("shakes").
 */
import { ALL_ROUTES } from "./routes";

export type TopicNodeKind = "symptom" | "part" | "service" | "system" | "season" | "clevelandCondition";

export interface TopicNode {
  id: string;
  kind: TopicNodeKind;
  label: string;
  /** Registry path. Every service node carries one; a symptom node carries its
   *  problem page when the site has one. Verified against ALL_ROUTES by test. */
  path?: string;
}

export interface TopicEdge {
  from: string;
  to: string;
  why: string;
}

export interface SymptomPattern {
  /** Symptom node id WITHOUT the `symptom:` prefix — the miner's symptomTopic key. */
  symptom: string;
  /** No `g` flag here; the miner builds its own global copy per scan. */
  re: RegExp;
}

const symptom = (id: string, label: string, path?: string): TopicNode => ({ id: `symptom:${id}`, kind: "symptom", label, path });
const part = (id: string, label: string): TopicNode => ({ id: `part:${id}`, kind: "part", label });
const service = (id: string, label: string, path: string): TopicNode => ({ id: `service:${id}`, kind: "service", label, path });
const system = (id: string, label: string): TopicNode => ({ id: `system:${id}`, kind: "system", label });
const season = (id: string, label: string): TopicNode => ({ id: `season:${id}`, kind: "season", label });
const cleveland = (id: string, label: string): TopicNode => ({ id: `cleveland:${id}`, kind: "clevelandCondition", label });

export const TOPIC_NODES: readonly TopicNode[] = [
  // ── symptoms (what the customer says) ──
  symptom("steering_shake", "steering wheel or car shakes at speed", "/steering-wheel-shaking"),
  symptom("brake_shake", "shakes or pulses when braking"),
  symptom("grinding", "grinding noise", "/grinding-noise-when-braking"),
  symptom("squeal", "squeal or squeak"),
  symptom("brake_soft", "soft or sinking brake pedal"),
  symptom("check_engine_flashing", "check engine light flashing", "/check-engine-light-flashing"),
  symptom("check_engine_on", "check engine light on", "/check-engine-light-on"),
  symptom("echeck_not_ready", "E-Check not ready or failed"),
  symptom("wont_start", "car won't start", "/car-wont-start"),
  symptom("pulls_one_side", "pulls to one side", "/car-pulling-to-one-side"),
  symptom("crooked_wheel", "steering wheel crooked when driving straight"),
  symptom("flat_puncture", "flat, nail, slow leak, plug or patch"),
  symptom("needs_tires", "needs a set of tires"),
  symptom("overheating", "overheating", "/car-overheating"),
  symptom("leak", "fluid leak or puddle", "/oil-leak-under-car"),
  symptom("clunk_knock", "clunk, knock or rattle"),
  symptom("tpms_light", "tire pressure light on"),
  symptom("battery_dies", "battery keeps dying", "/battery-keeps-dying"),
  symptom("ac_not_cold", "AC not blowing cold", "/ac-not-blowing-cold"),
  symptom("trans_slipping", "transmission slipping or hard shifting", "/transmission-slipping"),
  symptom("alignment_ask", "asks for an alignment"),
  symptom("rough_running", "stalls, rough idle or misfire"),
  symptom("loud_exhaust", "loud exhaust or muffler"),
  symptom("shaking_driving", "car shaking while driving", "/car-shaking-while-driving"),

  // ── parts ──
  part("tire_balance", "tire balance"),
  part("bent_wheel", "bent wheel"),
  part("tire_wear", "uneven or worn tread"),
  part("rotors", "brake rotors"),
  part("pads", "brake pads"),
  part("surface_rust", "surface rust on rotors"),
  part("brake_lines", "brake lines"),
  part("tie_rod", "tie rod end"),
  part("control_arm", "control arm / ball joint"),
  part("strut", "strut or shock"),
  part("sway_bar_link", "sway bar link"),
  part("wheel_bearing", "wheel bearing"),
  part("starter", "starter"),
  part("battery", "battery"),
  part("battery_terminals", "battery terminals"),
  part("alternator", "alternator"),
  part("ignition_switch", "ignition switch"),
  part("drive_cycle", "OBD drive cycle / readiness monitors"),
  part("gas_cap", "gas cap"),
  part("o2_sensor", "oxygen sensor"),
  part("catalytic_converter", "catalytic converter"),
  part("spark_plugs", "spark plugs / coils"),
  part("tpms_sensor", "TPMS sensor"),
  part("radiator", "radiator"),
  part("thermostat", "thermostat"),
  part("water_pump", "water pump"),
  part("coolant_hose", "coolant hose"),
  part("serpentine_belt", "serpentine belt"),
  part("ac_compressor", "AC compressor / refrigerant"),
  part("trans_fluid", "transmission fluid"),
  part("muffler", "muffler / exhaust pipe"),
  part("subframe", "subframe / frame rust"),
  part("puncture", "tire puncture location"),

  // ── services (registry routes only) ──
  service("tires", "tires", "/tires"),
  service("used_tires", "used tires", "/used-tires-cleveland"),
  service("wheels", "wheels", "/wheels"),
  service("brakes", "brakes", "/brakes"),
  service("alignment", "wheel alignment", "/alignment"),
  service("diagnostics", "diagnostics", "/diagnostics"),
  service("check_engine", "check engine light diagnostic", "/check-engine-light-diagnostic"),
  service("emissions", "E-Check / emissions", "/emissions"),
  service("oil_change", "oil change", "/oil-change"),
  service("battery", "battery", "/battery"),
  service("starter_alternator", "starter and alternator", "/starter-alternator"),
  service("electrical", "auto electrical", "/electrical"),
  service("cooling", "cooling system", "/cooling"),
  service("exhaust", "muffler and exhaust", "/exhaust"),
  service("ac", "AC repair", "/ac-repair"),
  service("transmission", "transmission", "/transmission"),
  service("belts_hoses", "belts and hoses", "/belts-hoses"),
  service("auto_repair", "general auto repair", "/auto-repair-near-me"),

  // ── systems ──
  system("brakes", "brake system"),
  system("steering_suspension", "steering and suspension"),
  system("wheels_tires", "wheels and tires"),
  system("engine", "engine"),
  system("electrical", "electrical and charging"),
  system("cooling", "cooling"),
  system("drivetrain", "drivetrain"),
  system("emissions", "emissions"),
  system("hvac", "heating and AC"),

  // ── seasons / Cleveland conditions ──
  season("winter", "winter"),
  season("spring_thaw", "spring thaw"),
  season("summer", "summer"),
  season("fall", "fall"),
  cleveland("road_salt", "road salt"),
  cleveland("potholes", "potholes"),
  cleveland("freeze_thaw", "freeze-thaw cycles"),
  cleveland("lake_effect_cold", "lake-effect cold snaps"),
  cleveland("humid_heat", "humid summer heat"),
];

const e = (from: string, to: string, why: string): TopicEdge => ({ from, to, why });

export const TOPIC_EDGES: readonly TopicEdge[] = [
  // steering shake → balance / bent wheel / alignment / suspension / brakes
  e("symptom:steering_shake", "part:tire_balance", "a shake that starts at 55-65 mph and fades above is the classic out-of-balance signature"),
  e("symptom:steering_shake", "part:bent_wheel", "a pothole can bend a wheel; the shake then shows at every speed and gets worse, not better"),
  e("symptom:steering_shake", "part:tire_wear", "cupped or separated tread shakes like a bad balance and will not balance out"),
  e("symptom:steering_shake", "part:tie_rod", "worn tie rod ends let the wheel wander and shimmy on the highway"),
  e("symptom:steering_shake", "part:control_arm", "a loose ball joint or bushing turns small road input into a steering shake"),
  e("symptom:steering_shake", "part:rotors", "if it shakes mainly when braking the rotors, not the tires, are the suspect"),
  e("symptom:steering_shake", "service:tires", "balance and tread inspection happen on the tire machine first"),
  e("symptom:steering_shake", "service:alignment", "an alignment check reads the suspension at the same time"),
  e("symptom:steering_shake", "system:steering_suspension", "steering shake lives in this system"),
  e("symptom:shaking_driving", "symptom:steering_shake", "the same complaint phrased from the seat instead of the wheel"),
  e("symptom:shaking_driving", "part:tire_balance", "whole-car shake at speed is usually a rear tire out of balance"),
  e("symptom:shaking_driving", "service:tires", "start on the tire machine"),

  // brake shake
  e("symptom:brake_shake", "part:rotors", "rotor thickness variation pulses through the pedal and wheel"),
  e("symptom:brake_shake", "part:pads", "pad material deposited unevenly on the rotor reads as warp"),
  e("symptom:brake_shake", "service:brakes", "brake inspection with rotor runout measurement"),
  e("symptom:brake_shake", "system:brakes", "brake pulsation lives in this system"),

  // grinding → pads / rotors / surface rust / bearing
  e("symptom:grinding", "part:pads", "pads worn to the backing plate grind metal on metal"),
  e("symptom:grinding", "part:rotors", "a grooved rotor grinds even with new pads"),
  e("symptom:grinding", "part:surface_rust", "a car that sat in rain grinds for the first few stops and then clears — that one is not a repair"),
  e("symptom:grinding", "part:wheel_bearing", "a grind that follows speed, not braking, is often a bearing"),
  e("symptom:grinding", "service:brakes", "brake inspection first; it is the common and the dangerous cause"),
  e("symptom:grinding", "system:brakes", "grinding is usually a brake-system noise"),

  // squeal
  e("symptom:squeal", "part:pads", "the wear indicator squeals on purpose when the pad is nearly done"),
  e("symptom:squeal", "part:serpentine_belt", "a squeal at startup or with the AC on is the belt, not the brakes"),
  e("symptom:squeal", "service:brakes", "brake squeal is checked on the lift"),
  e("symptom:squeal", "service:belts_hoses", "belt squeal is a belt and tensioner check"),

  // soft pedal
  e("symptom:brake_soft", "part:brake_lines", "a pedal that sinks points at a leak — in Cleveland, usually a rusted steel line"),
  e("symptom:brake_soft", "service:brakes", "hydraulic inspection and line replacement"),
  e("cleveland:road_salt", "part:brake_lines", "salt eats the steel brake lines from the outside in"),

  // check engine
  e("symptom:check_engine_flashing", "part:spark_plugs", "a flashing light means an active misfire, and plugs or coils are the usual cause"),
  e("symptom:check_engine_flashing", "part:catalytic_converter", "driving on a misfire dumps raw fuel into the converter and cooks it"),
  e("symptom:check_engine_flashing", "service:check_engine", "flashing is a stop-driving-and-scan light"),
  e("symptom:check_engine_on", "part:gas_cap", "a loose cap sets an evap code; the cheapest check engine light there is"),
  e("symptom:check_engine_on", "part:o2_sensor", "oxygen sensor codes are the most common steady-light cause"),
  e("symptom:check_engine_on", "part:catalytic_converter", "efficiency codes point at the converter — confirm before replacing"),
  e("symptom:check_engine_on", "service:check_engine", "a scan reads the stored code; the code is a clue, not a diagnosis"),
  e("symptom:check_engine_on", "service:diagnostics", "diagnostics confirms the cause behind the code"),
  e("symptom:check_engine_on", "system:engine", "steady light, engine management"),
  e("symptom:check_engine_on", "system:emissions", "most check engine codes are emissions codes"),
  e("symptom:check_engine_flashing", "symptom:check_engine_on", "same light, worse meaning"),

  // E-Check not ready → drive cycle / battery disconnect / cleared codes
  e("symptom:echeck_not_ready", "part:drive_cycle", "readiness monitors need a specific drive cycle to complete after a reset"),
  e("symptom:echeck_not_ready", "part:battery", "a dead or disconnected battery wipes the monitors, so a fresh battery can fail E-Check as not ready"),
  e("symptom:echeck_not_ready", "part:battery_terminals", "disconnecting the terminals to clear a light also clears readiness"),
  e("symptom:echeck_not_ready", "service:emissions", "E-Check readiness check and drive-cycle plan"),
  e("symptom:echeck_not_ready", "system:emissions", "readiness is an emissions-system state"),
  e("symptom:check_engine_on", "symptom:echeck_not_ready", "a lit check engine light fails Ohio E-Check outright"),

  // won't start / lights work → starter / ignition / terminals
  e("symptom:wont_start", "part:starter", "lights work but it only clicks — the starter is not turning the engine"),
  e("symptom:wont_start", "part:battery_terminals", "corroded terminals pass enough current for lights and not for the starter"),
  e("symptom:wont_start", "part:battery", "a single click or nothing with dim lights is the battery"),
  e("symptom:wont_start", "part:ignition_switch", "no click and no dash response points at the switch or security system"),
  e("symptom:wont_start", "part:alternator", "a battery that died while driving was not being charged"),
  e("symptom:wont_start", "service:battery", "free load test before anything is sold"),
  e("symptom:wont_start", "service:starter_alternator", "voltage drop and starter draw test"),
  e("symptom:wont_start", "service:electrical", "trace before swap when the simple tests pass"),
  e("symptom:wont_start", "system:electrical", "no-start is a starting and charging system problem until proven otherwise"),
  e("symptom:battery_dies", "part:battery", "a battery that will not hold a charge"),
  e("symptom:battery_dies", "part:alternator", "a good battery that keeps dying is not being charged"),
  e("symptom:battery_dies", "service:battery", "load test the battery and the charging system together"),
  e("symptom:battery_dies", "service:electrical", "a parasitic draw drains a good battery overnight"),
  e("cleveland:lake_effect_cold", "part:battery", "a weak battery shows itself on the first below-zero morning"),
  e("season:winter", "symptom:wont_start", "cold thickens oil and halves battery output"),
  e("season:winter", "symptom:battery_dies", "winter is battery season"),

  // pulls / crooked wheel
  e("symptom:pulls_one_side", "service:alignment", "a pull is the alignment complaint"),
  e("symptom:pulls_one_side", "part:tire_wear", "a pull that follows the tire when swapped side to side is the tire, not the alignment"),
  e("symptom:pulls_one_side", "part:pads", "a stuck caliper pulls under braking only"),
  e("symptom:pulls_one_side", "system:steering_suspension", "pull lives in this system"),
  e("symptom:crooked_wheel", "service:alignment", "an off-center wheel after a pothole is an alignment and a tie-rod check"),
  e("symptom:crooked_wheel", "part:tie_rod", "a bent tie rod shifts the wheel position"),
  e("symptom:alignment_ask", "service:alignment", "the customer named the service"),
  e("symptom:alignment_ask", "part:tire_wear", "an alignment on worn-out tires is money spent twice"),

  // plug vs patch → puncture location
  e("symptom:flat_puncture", "part:puncture", "plug vs patch is decided by where the hole is — tread center repairs, shoulder and sidewall do not"),
  e("symptom:flat_puncture", "part:tpms_sensor", "a slow leak with the light on is checked at the sensor seal too"),
  e("symptom:flat_puncture", "service:tires", "tire repair is a tire-shop job"),
  e("symptom:flat_puncture", "service:used_tires", "a sidewall puncture means a replacement; a used tire is the budget answer"),
  e("symptom:needs_tires", "service:tires", "new tire sets"),
  e("symptom:needs_tires", "service:used_tires", "used sets and pairs"),
  e("symptom:needs_tires", "service:alignment", "new tires on a bad alignment wear out early"),
  e("symptom:needs_tires", "system:wheels_tires", "tires"),

  // TPMS → temperature / puncture
  e("symptom:tpms_light", "cleveland:lake_effect_cold", "pressure drops about 1 psi per 10°F; the first cold morning lights every TPMS in town"),
  e("symptom:tpms_light", "part:puncture", "a light that comes back after topping off is a leak, not the weather"),
  e("symptom:tpms_light", "part:tpms_sensor", "a flashing TPMS light is a sensor fault, not low pressure"),
  e("symptom:tpms_light", "service:tires", "pressure check and leak test"),
  e("season:fall", "symptom:tpms_light", "first cold mornings"),
  e("season:winter", "symptom:tpms_light", "sustained cold keeps pressures low"),

  // potholes → wheel / alignment / suspension
  e("cleveland:potholes", "part:bent_wheel", "the pothole hit that bends the rim"),
  e("cleveland:potholes", "part:strut", "a blown strut after a hard hit — bounce and clunk"),
  e("cleveland:potholes", "part:control_arm", "a pothole can bend a control arm or pop a ball joint"),
  e("cleveland:potholes", "symptom:steering_shake", "shake that started after a pothole"),
  e("cleveland:potholes", "symptom:crooked_wheel", "wheel off-center after a pothole"),
  e("cleveland:potholes", "symptom:clunk_knock", "the clunk that started after a pothole"),
  e("season:spring_thaw", "cleveland:potholes", "freeze-thaw opens the potholes in March"),
  e("cleveland:freeze_thaw", "cleveland:potholes", "the mechanism behind pothole season"),

  // clunk / knock
  e("symptom:clunk_knock", "part:sway_bar_link", "a clunk over small bumps at low speed is the cheapest suspension fix"),
  e("symptom:clunk_knock", "part:strut", "a clunk with bounce is the strut mount or strut"),
  e("symptom:clunk_knock", "part:control_arm", "a clunk under braking or turning is a ball joint or bushing"),
  e("symptom:clunk_knock", "service:auto_repair", "suspension inspection on the lift"),
  e("symptom:clunk_knock", "system:steering_suspension", "clunks live here"),

  // salt → brake lines / subframe / battery
  e("cleveland:road_salt", "part:subframe", "salt rusts subframes and rocker panels from underneath"),
  e("cleveland:road_salt", "part:muffler", "exhaust hangers and mufflers rust through from salt spray"),
  e("cleveland:road_salt", "part:battery_terminals", "salt air corrodes terminals faster"),
  e("cleveland:road_salt", "symptom:brake_soft", "a rusted line is the Cleveland soft pedal"),
  e("cleveland:road_salt", "symptom:loud_exhaust", "a muffler that fell off in February"),
  e("season:winter", "cleveland:road_salt", "salt season"),

  // overheating / leaks / cooling
  e("symptom:overheating", "part:thermostat", "a stuck thermostat overheats on the highway and runs cold in town"),
  e("symptom:overheating", "part:water_pump", "a failing pump weeps coolant and overheats under load"),
  e("symptom:overheating", "part:radiator", "a clogged or leaking radiator cannot shed heat in traffic"),
  e("symptom:overheating", "part:coolant_hose", "a split hose dumps coolant fast"),
  e("symptom:overheating", "service:cooling", "pressure test before parts"),
  e("symptom:overheating", "system:cooling", "overheating is a cooling-system complaint"),
  e("season:summer", "symptom:overheating", "heat and AC load expose a marginal cooling system"),
  e("cleveland:humid_heat", "symptom:overheating", "humid July traffic is the stress test"),
  e("symptom:leak", "part:coolant_hose", "green, orange or pink puddle: coolant"),
  e("symptom:leak", "part:water_pump", "coolant drip from the front of the engine"),
  e("symptom:leak", "service:oil_change", "a dark puddle gets found on the oil-change inspection"),
  e("symptom:leak", "service:cooling", "coolant leaks are a pressure-test job"),
  e("symptom:leak", "service:diagnostics", "dye and inspection to find the source"),

  // AC
  e("symptom:ac_not_cold", "part:ac_compressor", "low refrigerant or a compressor that will not engage"),
  e("symptom:ac_not_cold", "part:serpentine_belt", "a slipping belt cannot spin the compressor"),
  e("symptom:ac_not_cold", "service:ac", "UV dye leak test and recharge"),
  e("symptom:ac_not_cold", "system:hvac", "no cold air is an HVAC-system complaint"),
  e("season:summer", "symptom:ac_not_cold", "the first hot week fills the AC calendar"),

  // transmission
  e("symptom:trans_slipping", "part:trans_fluid", "low or burnt fluid is the first and cheapest check"),
  e("symptom:trans_slipping", "service:transmission", "fluid first, rebuild last"),
  e("symptom:trans_slipping", "system:drivetrain", "transmission"),

  // rough running / exhaust
  e("symptom:rough_running", "part:spark_plugs", "misfire, rough idle and hesitation start at plugs and coils"),
  e("symptom:rough_running", "symptom:check_engine_on", "a misfire usually brings the light with it"),
  e("symptom:rough_running", "service:diagnostics", "diagnose before parts"),
  e("symptom:rough_running", "system:engine", "engine"),
  e("symptom:loud_exhaust", "part:muffler", "the rumble is a hole or a dropped muffler"),
  e("symptom:loud_exhaust", "part:catalytic_converter", "a rattle from under the car can be a broken converter substrate"),
  e("symptom:loud_exhaust", "service:exhaust", "muffler and weld jobs"),

  // systems ↔ services
  e("system:brakes", "service:brakes", "brake system work"),
  e("system:steering_suspension", "service:alignment", "alignment reads the whole system"),
  e("system:wheels_tires", "service:tires", "tires"),
  e("system:wheels_tires", "service:wheels", "wheels"),
  e("system:engine", "service:diagnostics", "engine diagnostics"),
  e("system:electrical", "service:electrical", "electrical"),
  e("system:cooling", "service:cooling", "cooling"),
  e("system:drivetrain", "service:transmission", "transmission"),
  e("system:emissions", "service:emissions", "E-Check"),
  e("system:hvac", "service:ac", "AC repair owns the HVAC system"),

  // parts ↔ services (so symptom → part → service resolves to a route)
  e("part:tire_balance", "service:tires", "balancing"),
  e("part:bent_wheel", "service:wheels", "wheel replacement or straightening referral"),
  e("part:tire_wear", "service:tires", "tread inspection and replacement"),
  e("part:rotors", "service:brakes", "rotor replacement"),
  e("part:pads", "service:brakes", "pad replacement"),
  e("part:brake_lines", "service:brakes", "line replacement"),
  e("part:tie_rod", "service:alignment", "tie rod replacement is followed by an alignment"),
  e("part:control_arm", "service:auto_repair", "suspension repair"),
  e("part:strut", "service:auto_repair", "strut replacement"),
  e("part:sway_bar_link", "service:auto_repair", "sway bar link"),
  e("part:wheel_bearing", "service:auto_repair", "hub and bearing"),
  e("part:starter", "service:starter_alternator", "starter"),
  e("part:alternator", "service:starter_alternator", "alternator"),
  e("part:battery", "service:battery", "battery"),
  e("part:battery_terminals", "service:battery", "terminal cleaning"),
  e("part:ignition_switch", "service:electrical", "ignition and security tracing"),
  e("part:drive_cycle", "service:emissions", "readiness drive cycle"),
  e("part:gas_cap", "service:check_engine", "evap code"),
  e("part:o2_sensor", "service:check_engine", "sensor code"),
  e("part:catalytic_converter", "service:exhaust", "converter replacement"),
  e("part:spark_plugs", "service:diagnostics", "misfire diagnosis"),
  e("part:tpms_sensor", "service:tires", "sensor service"),
  e("part:radiator", "service:cooling", "radiator"),
  e("part:thermostat", "service:cooling", "thermostat"),
  e("part:water_pump", "service:cooling", "water pump"),
  e("part:coolant_hose", "service:belts_hoses", "hose replacement"),
  e("part:serpentine_belt", "service:belts_hoses", "belt and tensioner"),
  e("part:ac_compressor", "service:ac", "compressor and recharge"),
  e("part:trans_fluid", "service:transmission", "fluid service"),
  e("part:muffler", "service:exhaust", "muffler"),
  e("part:subframe", "service:auto_repair", "rust inspection"),
  e("part:puncture", "service:tires", "plug or patch"),
];

/**
 * Customer-vocabulary bank. First claim wins, so order specific → general.
 * Every `symptom` must be a node id here (asserted in topicGraph.test.ts).
 */
export const SYMPTOM_PATTERNS: readonly SymptomPattern[] = [
  { symptom: "brake_shake", re: /\b(?:shak|vibrat|shudder|puls)\w*\s+(?:when|while|as|if)\s+(?:i\s+|you\s+|i'm\s+)?(?:brak|stop|slow)\w*/i },
  { symptom: "brake_shake", re: /\bbrak\w*\s+(?:are\s+|is\s+)?(?:shak|vibrat|puls|shudder)\w*/i },
  { symptom: "brake_soft", re: /\b(?:brake\s+pedal|pedal|brakes?)\s+(?:is\s+|are\s+|feels?\s+|goes\s+)?(?:to\s+the\s+floor|soft|spongy|mushy|sinks?)\b/i },
  { symptom: "grinding", re: /\bgrind\w*(?:\s+(?:noise|sound|when\s+(?:i\s+)?(?:brak|stop)\w*))?/i },
  { symptom: "squeal", re: /\b(?:squeal|squeak|screech|squeel)\w*(?:\s+(?:noise|sound|when\s+(?:i\s+)?(?:brak|stop|start)\w*))?/i },
  { symptom: "check_engine_flashing", re: /\bcheck\s*engine\s*(?:light\s*)?(?:is\s*|was\s*|started\s*)?(?:flash|blink)\w*/i },
  { symptom: "check_engine_flashing", re: /\b(?:flash|blink)\w*\s+check\s*engine(?:\s+light)?/i },
  { symptom: "check_engine_on", re: /\bcheck\s*engine(?:\s+light)?(?:\s+(?:is|came|come|just\s+came|stays|keeps\s+coming|went)\s+(?:back\s+)?on)?/i },
  { symptom: "echeck_not_ready", re: /\b(?:fail|pass)\w*\s+(?:the\s+|my\s+)?(?:e[\s-]?check|emission\w*|smog)\b/i },
  { symptom: "echeck_not_ready", re: /\b(?:e[\s-]?check|emissions?(?:\s+test)?|smog(?:\s+test)?)\b/i },
  { symptom: "echeck_not_ready", re: /\b(?:monitors?\s+(?:are\s+)?not\s+ready|not\s+ready\s+(?:for\s+)?(?:e[\s-]?check|emissions?|inspection|the\s+test)|readiness)\b/i },
  { symptom: "wont_start", re: /\b(?:won'?t|wont|doesn'?t|does\s*not|will\s*not|not|can'?t|cant)\s+(?:start|turn\s+over|crank)\w*/i },
  { symptom: "wont_start", re: /\b(?:no\s+crank|no\s+start|just\s+clicks?|clicks?\s+(?:but|and)\s+(?:won'?t|wont|no|nothing)|lights?\s+(?:come\s+on|work)\w*\s+but)\b/i },
  { symptom: "battery_dies", re: /\bbattery\s+(?:keeps\s+|is\s+|was\s+)?(?:dy|die|dead|drain)\w*/i },
  { symptom: "battery_dies", re: /\b(?:(?:dead|drain\w*)\s+battery|needs?\s+(?:a\s+)?jump(?:\s*start)?)\b/i },
  { symptom: "pulls_one_side", re: /\b(?:pull|drift|veer)\w*\s+(?:to\s+(?:the\s+)?)?(?:left|right|one\s+side)\b/i },
  { symptom: "crooked_wheel", re: /\b(?:steering\s+)?wheel\s+(?:is\s+)?(?:crooked|off[\s-]?center|not\s+straight|sideways)\b/i },
  { symptom: "alignment_ask", re: /\balign\w*/i },
  { symptom: "needs_tires", re: /\b(?:all\s+(?:four|4)|set\s+of\s+(?:four|4)|four|4|two|2|pair\s+of)\s+(?:new\s+|used\s+)?tires?\b/i },
  { symptom: "needs_tires", re: /\b(?:need|needs|needing|looking\s+for|price\s+on|prices?\s+for|how\s+much\s+(?:for|are))\s+(?:a\s+|some\s+|new\s+|used\s+)*tires?\b/i },
  { symptom: "flat_puncture", re: /\b(?:plug|patch)\w*\s+(?:or|vs\.?|versus)\s+(?:plug|patch)\w*/i },
  { symptom: "flat_puncture", re: /\b(?:nail|screw|bolt)\s+in\s+(?:my\s+|the\s+)?tire\b/i },
  { symptom: "flat_puncture", re: /\b(?:(?:plug|patch)\w*\s+(?:the\s+|my\s+|a\s+)?tire|tire\s+(?:plug|patch|repair)\w*)/i },
  { symptom: "flat_puncture", re: /\b(?:flat\s+tire|slow\s+leak|losing\s+air|leak\w*\s+air|low\s+on\s+air|went\s+flat)\b/i },
  { symptom: "tpms_light", re: /\b(?:tpms|tire\s+pressure)\s*(?:light|sensor|warning)?(?:\s+(?:is\s+|came\s+)?on)?\b/i },
  { symptom: "tpms_light", re: /\b(?:low\s+tire\s+pressure|(?:tire|pressure)\s+light\s+(?:is\s+|came\s+)?on)\b/i },
  { symptom: "overheating", re: /\b(?:overheat\w*|running\s+hot|temp(?:erature)?\s+(?:gauge\s+)?(?:is\s+)?(?:high|hot|red|in\s+the\s+red|maxed)|steam\w*\s+(?:from|under|out))\b/i },
  { symptom: "ac_not_cold", re: /\b(?:a\/?c|air\s*condition\w*)\s+(?:is\s+)?(?:not|isn'?t|stopped|quit|won'?t|wont|doesn'?t)\s*(?:blow\w*\s+)?(?:cold|working|cool|get\w*\s+cold)\w*/i },
  { symptom: "ac_not_cold", re: /\b(?:(?:no|not)\s+cold\s+air|(?:ac|a\/c)\s+(?:blows?|blowing|is)\s+(?:hot|warm))\b/i },
  { symptom: "trans_slipping", re: /\b(?:transmission|trans|gears?)\s+(?:is\s+|are\s+)?(?:slip|jerk|slam|hard\s+shift|won'?t\s+shift|wont\s+shift|not\s+shift|stuck)\w*/i },
  { symptom: "trans_slipping", re: /\b(?:slipp?ing\s+(?:out\s+of\s+)?gear|hard\s+shift\w*)/i },
  { symptom: "loud_exhaust", re: /\b(?:(?:exhaust|muffler)\s+(?:is\s+)?(?:loud|rumbl|roar|rust|fell|drag|hang|leak)\w*|(?:loud|rumbl)\w*\s+(?:exhaust|muffler)|muffler)\b/i },
  { symptom: "rough_running", re: /\b(?:(?:stall|misfir|sputter|hesitat)\w*|rough\s+idle|idl\w*\s+rough)\b/i },
  { symptom: "leak", re: /\b(?:(?:oil|coolant|antifreeze|fluid|power\s+steering|brake\s+fluid)\s+(?:is\s+)?leak\w*|leak\w*\s+(?:oil|coolant|antifreeze|fluid)|(?:puddle|drip\w*)\s+(?:under|underneath)|leak\w*)\b/i },
  { symptom: "clunk_knock", re: /\b(?:clunk|knock|rattl|thump|bang)\w*(?:\s+(?:noise|sound|over\s+bumps))?\b/i },
  // General shake LAST so the braking-specific form above claims its span first.
  { symptom: "steering_shake", re: /\bsteering\s+wheel\s+(?:is\s+)?(?:shak|vibrat|wobbl|shimm)\w*/i },
  { symptom: "steering_shake", re: /\b(?:shak|vibrat|wobbl|shimm)\w*\s+(?:at|on|over|above|around)\s+(?:highway|high|\d+)\s*(?:speeds?|mph)?\b/i },
  { symptom: "shaking_driving", re: /\b(?:car|truck|suv|van|front\s+end|whole\s+car|it)\s+(?:is\s+|keeps\s+|started\s+)?(?:shak|vibrat|wobbl|shimm)\w*(?:\s+(?:when|while)\s+(?:i'?m\s+|i\s+)?driv\w*)?/i },
  { symptom: "shaking_driving", re: /\b(?:shak|vibrat|wobbl|shimm)\w*\s+(?:when|while)\s+(?:i'?m\s+|i\s+)?driv\w*/i },
];

const NODE_BY_ID: ReadonlyMap<string, TopicNode> = new Map(TOPIC_NODES.map((n) => [n.id, n]));
const REGISTRY_PATHS: ReadonlySet<string> = new Set(ALL_ROUTES.map((r) => r.path));

const stripPrefix = (key: string): string => key.replace(/^symptom:/, "");

/** Nodes connected to `nodeId` in either direction, optionally filtered by kind. */
export function neighbors(nodeId: string, kinds?: readonly TopicNodeKind[]): TopicNode[] {
  const out: TopicNode[] = [];
  const seen = new Set<string>();
  for (const edge of TOPIC_EDGES) {
    const other = edge.from === nodeId ? edge.to : edge.to === nodeId ? edge.from : null;
    if (!other || seen.has(other)) continue;
    const node = NODE_BY_ID.get(other);
    if (!node) continue;
    if (kinds && !kinds.includes(node.kind)) continue;
    seen.add(other);
    out.push(node);
  }
  return out;
}

/**
 * Registry routes for a symptom: its own problem page first (when the site has
 * one), then service pages reachable directly or through one part. Every path
 * is filtered against ALL_ROUTES, so a stale node can only drop out, never
 * emit a path the site does not serve.
 */
export function routesForSymptom(symptomKey: string): string[] {
  const id = `symptom:${stripPrefix(symptomKey)}`;
  const node = NODE_BY_ID.get(id);
  if (!node) return [];
  const paths: string[] = [];
  const push = (p: string | undefined) => {
    if (p && REGISTRY_PATHS.has(p) && !paths.includes(p)) paths.push(p);
  };
  push(node.path);
  const direct = neighbors(id);
  for (const n of direct) if (n.kind === "service") push(n.path);
  for (const n of direct) {
    if (n.kind !== "part") continue;
    for (const s of neighbors(n.id, ["service"])) push(s.path);
  }
  return paths;
}

/** The symptom key a customer phrase maps to, or null when the bank has no claim on it. */
export function symptomForPhrase(phrase: string): string | null {
  const text = String(phrase ?? "").trim();
  if (!text) return null;
  for (const p of SYMPTOM_PATTERNS) if (p.re.test(text)) return p.symptom;
  return null;
}
