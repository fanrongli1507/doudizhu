module.exports = { getCombo, beats, countRanks };

// Dou Dizhu evaluator — Ruleset A (Tencent / Official), now with 连对
const valueMap = {
  "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, "J": 11,
  "Q": 12, "K": 13, "A": 14, "2": 15,
  "Black Joker": 16,
  "Red Joker": 17
};

function cardValue(card) {
  if (card === "Black Joker" || card === "Red Joker") return valueMap[card];
  return valueMap[card.replace(/[^0-9JQKA]+/g, "")];
}

function countRanks(cards) {
  const freq = {};
  for (let c of cards) {
    const v = cardValue(c);
    freq[v] = (freq[v] || 0) + 1;
  }
  return freq;
}

function isStraight(values) {
  if (values.includes(15) || values.includes(16) || values.includes(17)) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) return false;
  }
  return true;
}

function findConsecutiveRuns(sortedValues, minLen = 2) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= sortedValues.length; i++) {
    if (i === sortedValues.length || sortedValues[i] !== sortedValues[i - 1] + 1) {
      const len = i - start;
      if (len >= minLen) runs.push({ start, end: i - 1, length: len });
      start = i;
    }
  }
  return runs;
}

function getCombo(hand) {
  const cards = hand.map(cardValue).sort((a, b) => a - b);
  const freq = countRanks(hand);
  const values = Object.keys(freq).map(Number).sort((a, b) => a - b);
  const len = hand.length;

  // Joker bomb
  if (len === 2 && freq[16] === 1 && freq[17] === 1) {
    return { type: "joker-bomb", value: 17, length: 2, valid: true };
  }

  // Bomb
  if (len === 4 && Object.values(freq).some(c => c === 4)) {
    const v = Number(Object.keys(freq).find(k => freq[k] === 4));
    return { type: "bomb", value: v, length: 4, valid: true };
  }

  // Single
  if (len === 1) return { type: "single", value: cards[0], length: 1, valid: true };

  // Pair
  if (len === 2 && Object.values(freq).some(c => c === 2)) {
    const v = Number(Object.keys(freq).find(k => freq[k] === 2));
    return { type: "pair", value: v, length: 2, valid: true };
  }

  // Triple
  if (len === 3 && Object.values(freq).some(c => c === 3)) {
    const v = Number(Object.keys(freq).find(k => freq[k] === 3));
    return { type: "triple", value: v, length: 3, valid: true };
  }

  // Triple + single
  if (len === 4 && Object.values(freq).some(c => c === 3)) {
    const v = Number(Object.keys(freq).find(k => freq[k] === 3));
    return { type: "triple-single", value: v, length: 4, valid: true };
  }

  // Triple + pair
  if (len === 5 && Object.values(freq).some(c => c === 3) && Object.values(freq).some(c => c === 2)) {
    const v = Number(Object.keys(freq).find(k => freq[k] === 3));
    return { type: "triple-pair", value: v, length: 5, valid: true };
  }

  // Straight (≥5)
  if (len >= 5 && Object.values(freq).every(c => c === 1) && isStraight(cards)) {
    return { type: "straight", value: cards[0], length: len, valid: true };
  }

  // Four-with-two
  if (Object.values(freq).some(c => c === 4)) {
    const fourRank = Number(Object.keys(freq).find(k => freq[k] === 4));
    const remainingCount = len - 4;
    const remFreq = {};
    for (let k of Object.keys(freq)) {
      const rk = Number(k);
      if (rk === fourRank) continue;
      remFreq[rk] = freq[k];
    }
    const remCounts = Object.values(remFreq);
    if (remainingCount === 2 && remCounts.length === 2 && remCounts.every(c => c === 1)) {
      return { type: "four-two-single", value: fourRank, length: len, valid: true };
    }
    if (remainingCount === 2 && remCounts.length === 1 && remCounts[0] === 2) {
      return { type: "four-two-pair", value: fourRank, length: len, valid: true };
    }
  }

  // Airplane and airplane-with-wings
  const triples = values.filter(v => freq[v] >= 3 && v !== 15 && v !== 16 && v !== 17);
  if (triples.length >= 2) {
    const runs = findConsecutiveRuns(triples, 2);
    for (let run of runs) {
      const runLen = run.length;
      const runValues = triples.slice(run.start, run.end + 1);
      const triplesCardCount = runLen * 3;
      const remainingCount = len - triplesCardCount;

      // Wings first
      if (remainingCount === runLen) {
        let okSingles = true;
        for (let k of Object.keys(freq)) {
          const rk = Number(k);
          if (runValues.includes(rk)) continue;
          if (freq[rk] > 1) okSingles = false;
        }
        if (okSingles) return { type: "airplane-single-wings", coreStart: runValues[0], coreLen: runLen, value: runValues[0], length: len, valid: true };
      }
      if (remainingCount === 2 * runLen) {
        let pairs = 0;
        let okPairs = true;
        for (let k of Object.keys(freq)) {
          const rk = Number(k);
          if (runValues.includes(rk)) continue;
          if (freq[rk] === 2) pairs++;
          else okPairs = false;
        }
        if (okPairs && pairs === runLen) return { type: "airplane-pair-wings", coreStart: runValues[0], coreLen: runLen, value: runValues[0], length: len, valid: true };
      }

      // Pure airplane
      if (len === triplesCardCount) return { type: "airplane", coreStart: runValues[0], coreLen: runLen, value: runValues[0], length: len, valid: true };
    }
  }

  // Sequential pairs (连对)
  const pairs = values.filter(v => freq[v] === 2 && v !== 15 && v !== 16 && v !== 17);
  if (pairs.length >= 3) {
    const pairRuns = findConsecutiveRuns(pairs, 3);
    for (let run of pairRuns) {
      const runLen = run.length;
      if (len === runLen * 2) return { type: "double-straight", coreStart: pairs[run.start], coreLen: runLen, value: pairs[run.start], length: len, valid: true };
    }
  }

  return { valid: false };
}

function beats(prevHand, currentHand) {
  const prev = getCombo(prevHand);
  const curr = getCombo(currentHand);

  if (!curr.valid) return false;
  if (!prev || !prev.valid) return true;

  if (curr.type === "joker-bomb") return true;
  if (prev.type === "joker-bomb") return false;

  if (curr.type === "bomb") {
    if (prev.type !== "bomb") return true;
    return curr.value > prev.value;
  }
  if (prev.type === "bomb") return false;

  if (curr.type !== prev.type) return false;

  switch(curr.type){
    case "single":
    case "pair":
    case "triple":
    case "triple-single":
    case "triple-pair":
    case "straight":
    case "four-two-single":
    case "four-two-pair":
    case "double-straight":
      if (curr.length !== prev.length) return false;
      return curr.value > prev.value;

    case "airplane":
    case "airplane-single-wings":
    case "airplane-pair-wings":
      if (curr.coreLen !== prev.coreLen) return false;
      return curr.value > prev.value;

    default: return false;
  }
}


