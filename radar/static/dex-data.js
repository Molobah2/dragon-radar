/* Collectible dragons (v2): 15 species, each as a common and a rare holo sticker, plus 5 golden legends.
   art: Cloudinary version of each render in dragon-radar/dex2/<key> (key = species id + -c, -r or -l). */
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
  art: {"shadow-c":"v1791761544","space-c":"v1791761546","speed-c":"v1791761548","tiger-c":"v1791761550","tree-c":"v1791761551","water-c":"v1791761553","acid-c":"v1791761554","ghost-c":"v1791761556","ice-c":"v1791761561","jelly-c":"v1791761563","light-c":"v1791761564","lightning-c":"v1791761566","lava-c":"v1791761570","panda-c":"v1791761656","pink-c":"v1791761569","shadow-r":"v1791761658","space-r":"v1791761659","speed-r":"v1791761661","tiger-r":"v1791761663","tree-r":"v1791761665","water-r":"v1791761576","acid-r":"v1791761667","ghost-r":"v1791761670","ice-r":"v1791761671","jelly-r":"v1791761745","light-r":"v1791761818","lightning-r":"v1791761819","lava-r":"v1791761572","panda-r":"v1791761746","pink-r":"v1791761821","ruby-l":"v1791761574","sapphire-l":"v1791761749","emerald-l":"v1791762105","amethyst-l":"v1791761823","diamond-l":"v1791761825"},
};
