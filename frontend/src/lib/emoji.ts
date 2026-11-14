/** A compact, searchable emoji catalog (no extra dependency). */
export type EmojiEntry = { e: string; n: string };

export const EMOJI_CATEGORIES: { name: string; items: EmojiEntry[] }[] = [
  {
    name: "Frequently used",
    items: [
      ["👍", "thumbsup +1 like"], ["❤️", "heart love"], ["😂", "joy laugh"], ["🎉", "tada party"],
      ["🙌", "raised hands celebrate"], ["👀", "eyes look"], ["✅", "white check mark done"], ["🔥", "fire lit"],
      ["🙏", "pray thanks please"], ["💯", "100 hundred"], ["🚀", "rocket ship launch"], ["👏", "clap applause"],
    ].map(([e, n]) => ({ e, n })),
  },
  {
    name: "Smileys",
    items: [
      ["😀", "grinning smile"], ["😃", "smiley"], ["😄", "smile happy"], ["😁", "grin"], ["😅", "sweat smile"],
      ["🤣", "rofl rolling"], ["🙂", "slight smile"], ["😉", "wink"], ["😊", "blush"], ["😇", "innocent halo"],
      ["🥰", "smiling hearts"], ["😍", "heart eyes"], ["🤩", "star struck"], ["😘", "kiss"], ["😋", "yum"],
      ["😜", "wink tongue"], ["🤪", "zany crazy"], ["🤗", "hug"], ["🤔", "thinking hmm"], ["🤫", "shush"],
      ["😐", "neutral"], ["😑", "expressionless"], ["🙄", "eye roll"], ["😏", "smirk"], ["😬", "grimace"],
      ["😌", "relieved"], ["😴", "sleeping"], ["😷", "mask sick"], ["🤒", "thermometer ill"], ["🤯", "mind blown"],
      ["🥳", "partying"], ["😎", "sunglasses cool"], ["🤓", "nerd"], ["😕", "confused"], ["😟", "worried"],
      ["😮", "open mouth wow"], ["😲", "astonished"], ["🥺", "pleading"], ["😢", "cry sad"], ["😭", "sob"],
      ["😱", "scream"], ["😤", "triumph huff"], ["😡", "rage angry"], ["🤬", "cursing"], ["💀", "skull dead"],
    ].map(([e, n]) => ({ e, n })),
  },
  {
    name: "People",
    items: [
      ["👋", "wave hello bye"], ["🤚", "raised back hand"], ["✋", "hand stop"], ["👌", "ok"], ["🤌", "pinched"],
      ["✌️", "victory peace"], ["🤞", "crossed fingers luck"], ["🤟", "love you"], ["🤘", "rock on"], ["👉", "point right"],
      ["👈", "point left"], ["👆", "point up"], ["👇", "point down"], ["👎", "thumbsdown -1 dislike"], ["✊", "fist"],
      ["🤝", "handshake deal"], ["💪", "muscle strong"], ["🧠", "brain"], ["🫡", "salute"], ["🤷", "shrug"],
      ["🙋", "raising hand"], ["🤦", "facepalm"], ["🙇", "bow"], ["💁", "tipping hand"], ["🧑‍💻", "technologist dev"],
    ].map(([e, n]) => ({ e, n })),
  },
  {
    name: "Nature & food",
    items: [
      ["🌟", "star glowing"], ["⭐", "star"], ["☀️", "sun"], ["🌈", "rainbow"], ["⚡", "zap lightning"],
      ["❄️", "snowflake"], ["🌱", "seedling grow"], ["🌸", "blossom"], ["🐶", "dog"], ["🐱", "cat"],
      ["🦄", "unicorn"], ["🐛", "bug"], ["☕", "coffee"], ["🍕", "pizza"], ["🍔", "burger"],
      ["🍩", "donut"], ["🎂", "cake birthday"], ["🍻", "beers cheers"], ["🥂", "champagne toast"], ["🍿", "popcorn"],
    ].map(([e, n]) => ({ e, n })),
  },
  {
    name: "Objects & symbols",
    items: [
      ["💡", "bulb idea"], ["📌", "pushpin pin"], ["📎", "paperclip"], ["📝", "memo note"], ["📅", "calendar date"],
      ["📈", "chart up"], ["📉", "chart down"], ["💻", "laptop computer"], ["📱", "phone mobile"], ["🔒", "lock"],
      ["🔑", "key"], ["🛠️", "tools"], ["⚙️", "gear settings"], ["🧪", "test tube"], ["🐞", "lady beetle bug"],
      ["📣", "mega announce"], ["🔔", "bell notification"], ["⏰", "alarm clock"], ["🏆", "trophy win"], ["🎯", "dart target"],
      ["❗", "exclamation"], ["❓", "question"], ["⚠️", "warning"], ["🚫", "no entry"], ["❌", "x cross"],
      ["➕", "plus add"], ["🟢", "green circle"], ["🟡", "yellow circle"], ["🔴", "red circle"], ["💬", "speech bubble"],
    ].map(([e, n]) => ({ e, n })),
  },
];

export const QUICK_REACTIONS = ["✅", "👀", "🙌"];

// --- :shortcodes: (Slack-style) -------------------------------------------------------------------

/** Common Slack shortcodes, plus a few emoji that aren't in the picker. */
const SHORTCODE_ALIASES: Record<string, string> = {
  "+1": "👍", thumbsup: "👍", "-1": "👎", thumbsdown: "👎", heart: "❤️", red_heart: "❤️", joy: "😂",
  tada: "🎉", raised_hands: "🙌", eyes: "👀", white_check_mark: "✅", heavy_check_mark: "✔️", x: "❌",
  fire: "🔥", pray: "🙏", 100: "💯", rocket: "🚀", clap: "👏", smile: "😄", smiley: "😃", grinning: "😀",
  laughing: "😆", sweat_smile: "😅", rolling_on_the_floor_laughing: "🤣", slightly_smiling_face: "🙂",
  wink: "😉", blush: "😊", heart_eyes: "😍", star_struck: "🤩", thinking_face: "🤔", thinking: "🤔",
  partying_face: "🥳", sunglasses: "😎", exploding_head: "🤯", cry: "😢", sob: "😭", scream: "😱",
  rage: "😡", skull: "💀", wave: "👋", ok_hand: "👌", v: "✌️", crossed_fingers: "🤞", muscle: "💪",
  handshake: "🤝", shrug: "🤷", facepalm: "🤦", point_right: "👉", point_left: "👈", point_up: "👆",
  point_down: "👇", sparkles: "✨", star: "⭐", zap: "⚡", warning: "⚠️", bulb: "💡", coffee: "☕",
  memo: "📝", calendar: "📅", slightly_frowning_face: "🙁", see_no_evil: "🙈", salute: "🫡",
};

let shortcodes: Map<string, string> | null = null;

/** Every alias above, then each picker entry's keywords (and their first 2–3 joined by "_"). */
function shortcodeMap(): Map<string, string> {
  if (shortcodes) return shortcodes;
  const map = new Map<string, string>(Object.entries(SHORTCODE_ALIASES));
  for (const { items } of EMOJI_CATEGORIES) {
    for (const { e, n } of items) {
      const words = n.toLowerCase().split(/\s+/).filter(Boolean);
      const keys = [words.slice(0, 3).join("_"), words.slice(0, 2).join("_"), ...words];
      for (const k of keys) if (k && !map.has(k)) map.set(k, e);
    }
  }
  shortcodes = map;
  return map;
}

/** ":heart: thanks :+1:" → "❤️ thanks 👍". Unknown codes (and times like 10:30:45) stay as typed. */
export function replaceShortcodes(text: string): string {
  if (!text.includes(":")) return text;
  return text.replace(/:([a-z0-9_+-]{1,40}):/gi, (m, code: string) => shortcodeMap().get(code.toLowerCase()) ?? m);
}
