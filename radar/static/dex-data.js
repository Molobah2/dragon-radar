/* Collectible dragons (v2): which sticker lives where on the four art sheets.
   Boxes are [x, y, w, h] in the 2688 x 1520 sheet pixels. */
window.PD_DEX = {
  sheets: {
    a: { v: "v1791758746", boxes: [[12,381,516,729],[540,432,477,672],[1017,378,579,639],[1596,531,528,564],[2133,375,546,717]] },
    b: { v: "v1791758748", boxes: [[27,360,513,720],[540,348,477,729],[1020,357,483,714],[1512,471,603,612],[2118,351,534,729]] },
    c: { v: "v1791758750", boxes: [[21,363,513,705],[552,363,495,705],[1047,357,498,711],[1569,399,513,666],[2106,354,564,729]] },
    gold: { v: "v1791758752", boxes: [[0,363,582,696],[582,354,465,708],[1050,366,522,699],[1572,348,543,696],[2121,354,537,705]] },
  },
  // one per egg species, same order as the eggs in the hatchery
  dragons: [
    { id: "shadow", name: "Shadow", pose: "Says hi", sheet: "a", slot: 0, egg: ["#3a3340", "#8a8494"] },
    { id: "space", name: "Space", pose: "Tail hug", sheet: "a", slot: 1, egg: ["#4b2fa0", "#e04aa8"] },
    { id: "speed", name: "Speed", pose: "Takes off", sheet: "a", slot: 2, egg: ["#f2b51c", "#5a3410"] },
    { id: "tiger", name: "Tiger", pose: "Nap time", sheet: "a", slot: 3, egg: ["#f07a1e", "#5a2a10"] },
    { id: "tree", name: "Tree", pose: "Big jump", sheet: "a", slot: 4, egg: ["#8a7258", "#5aa040"] },
    { id: "water", name: "Water", pose: "Bubble", sheet: "b", slot: 0, egg: ["#1f5fb8", "#9fd0f5"] },
    { id: "acid", name: "Acid", pose: "Cheers", sheet: "b", slot: 1, egg: ["#7ccf2a", "#2f6a1a"] },
    { id: "ghost", name: "Ghost", pose: "Shy wink", sheet: "b", slot: 2, egg: ["#efece6", "#9a9a9a"] },
    { id: "ice", name: "Ice", pose: "Slide", sheet: "b", slot: 3, egg: ["#d8ecf8", "#7fb4dc"] },
    { id: "jelly", name: "Jelly", pose: "Little heart", sheet: "b", slot: 4, egg: ["#d6ac2a", "#f5e6b8"] },
    { id: "light", name: "Light", pose: "Morning stretch", sheet: "c", slot: 0, egg: ["#f3e6cc", "#d08a4a"] },
    { id: "lightning", name: "Lightning", pose: "Spark", sheet: "c", slot: 1, egg: ["#f8f2e4", "#f07a1e"] },
    { id: "lava", name: "Lava", pose: "Tiny roar", sheet: "c", slot: 2, egg: ["#f26a1a", "#f7c531"] },
    { id: "panda", name: "Panda", pose: "Snack", sheet: "c", slot: 3, egg: ["#f4f4f2", "#1c2238"] },
    { id: "pink", name: "Pink", pose: "Happy dance", sheet: "c", slot: 4, egg: ["#d99ad8", "#c0308f"] },
  ],
  // golden legends, very hard to find
  legends: [
    { id: "ruby", name: "Ruby", pose: "Wings wide", sheet: "gold", slot: 0 },
    { id: "sapphire", name: "Sapphire", pose: "Little crown", sheet: "gold", slot: 1 },
    { id: "emerald", name: "Emerald", pose: "Gold hoard", sheet: "gold", slot: 2 },
    { id: "amethyst", name: "Amethyst", pose: "Sky dash", sheet: "gold", slot: 3 },
    { id: "diamond", name: "Diamond", pose: "Hero pose", sheet: "gold", slot: 4 },
  ],
};
