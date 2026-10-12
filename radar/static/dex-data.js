/* Collectible dragons (v2): 15 species, each as a common and a rare holo sticker, plus 5 golden legends.
   art: Cloudinary version of each render in dragon-radar/dex3/<key> (key = species id + -c, -r or -l). */
window.PD_DEX = {
  dragons: [
    { id: "shadow", name: "Shadow", egg: ["#3a3340", "#8a8494"], pose: { c: "Says hi", r: "Out of the shadows" } },
    { id: "space", name: "Space", egg: ["#4b2fa0", "#e04aa8"], pose: { c: "Tail hug", r: "Star walker" } },
    { id: "speed", name: "Speed", egg: ["#f2b51c", "#5a3410"], pose: { c: "Zoom", r: "Lightning dash" } },
    { id: "tiger", name: "Tiger", egg: ["#f07a1e", "#5a2a10"], pose: { c: "Nap time", r: "Pounce" } },
    { id: "tree", name: "Tree", egg: ["#8a7258", "#5aa040"], pose: { c: "Big jump", r: "Vine keeper" } },
    { id: "water", name: "Water", egg: ["#1f5fb8", "#9fd0f5"], pose: { c: "Bubble", r: "Wave rider" } },
    { id: "acid", name: "Acid", egg: ["#7ccf2a", "#2f6a1a"], pose: { c: "Cheers", r: "Potion maker" } },
    { id: "ghost", name: "Ghost", egg: ["#efece6", "#9a9a9a"], pose: { c: "Shy peek", r: "Boo" } },
    { id: "ice", name: "Ice", egg: ["#d8ecf8", "#7fb4dc"], pose: { c: "Belly slide", r: "Frost breath" } },
    { id: "jelly", name: "Jelly", egg: ["#d6ac2a", "#f5e6b8"], pose: { c: "Little heart", r: "Jelly bounce" } },
    { id: "light", name: "Light", egg: ["#f3e6cc", "#d08a4a"], pose: { c: "Morning stretch", r: "Halo" } },
    { id: "lightning", name: "Lightning", egg: ["#f8f2e4", "#f07a1e"], pose: { c: "Spark", r: "Fully charged" } },
    { id: "lava", name: "Lava", egg: ["#f26a1a", "#f7c531"], pose: { c: "Tiny roar", r: "Ember flight" } },
    { id: "panda", name: "Panda", egg: ["#f4f4f2", "#1c2238"], pose: { c: "Snack", r: "Bamboo kick" } },
    { id: "pink", name: "Pink", egg: ["#d99ad8", "#c0308f"], pose: { c: "Happy dance", r: "Blown kiss" } },
  ],
  legends: [
    { id: "ruby", name: "Ruby", pose: "Crowned hoard" },
    { id: "sapphire", name: "Sapphire", pose: "Royal scepter" },
    { id: "emerald", name: "Emerald", pose: "Emerald orb" },
    { id: "amethyst", name: "Amethyst", pose: "Crystal flight" },
    { id: "diamond", name: "Diamond", pose: "Hero cape" },
  ],
  // secret relics: how to earn them is never written on the site
  secrets: [
    { id: "moon", name: "Moonsilver Keeper", pose: "Secret relic", line: "Silver light finds the ones who keep showing up." },
    { id: "ember", name: "Ember Warden", pose: "Secret relic", line: "A warm little fire that keeps every Keeper close." },
    { id: "star", name: "Starborn Sovereign", pose: "Secret relic", line: "Written in the stars long before the first egg." },
  ],
  secretArt: { "moon-s": "v1791831803", "ember-s": "v1791831805", "star-s": "v1791831808" },
  art: {"shadow-c":"v1791763925","space-c":"v1791764135","speed-c":"v1791763928","tiger-c":"v1791763930","tree-c":"v1791763932","water-c":"v1791763933","acid-c":"v1791763935","ghost-c":"v1791763937","ice-c":"v1791764264","jelly-c":"v1791764019","light-c":"v1791764137","lightning-c":"v1791763939","lava-c":"v1791763810","panda-c":"v1791764021","pink-c":"v1791764023","shadow-r":"v1791764266","space-r":"v1791764139","speed-r":"v1791764268","tiger-r":"v1791764270","tree-r":"v1791764272","water-r":"v1791763811","acid-r":"v1791764142","ghost-r":"v1791764144","ice-r":"v1791764274","jelly-r":"v1791764277","light-r":"v1791764348","lightning-r":"v1791764351","lava-r":"v1791764279","panda-r":"v1791764352","pink-r":"v1791764354","ruby-l":"v1791763813","sapphire-l":"v1791764138","emerald-l":"v1791764024","amethyst-l":"v1791764355","diamond-l":"v1791764357"},
};
