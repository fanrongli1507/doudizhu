const io = require('socket.io')(6969, {
  cors: { origin: "*" }
});

// --- Card values ---
const valueMap = {
  "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, "J": 11,
  "Q": 12, "K": 13, "A": 14, "2": 15,
  "Black Joker": 16,
  "Red Joker": 17
};

function cardValue(card) {
  // Ensure we handle cards that might include a suit if the client was not updated
  const cardName = card.replace(/[♠♥♣♦]/, '');
  return valueMap[cardName];
}

function sortHand(hand) {
  // Ensure hand is always an array before sorting/mapping
  const arrayHand = Array.isArray(hand) ? hand : [hand];
  // Use slice() to ensure the original array is not modified
  return arrayHand.slice().sort((a, b) => cardValue(a) - cardValue(b));
}

// --- Deal cards ---
function dealCards() {
  // Using the simplified card names from your current server.js
  const deck = [
    "3","3","3","3","4","4","4","4","5","5","5","5","6","6","6","6",
    "7","7","7","7","8","8","8","8","9","9","9","9","10","10","10","10",
    "J","J","J","J","Q","Q","Q","Q","K","K","K","K","A","A","A","A",
    "2","2","2","2","Black Joker","Red Joker"
  ];

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const p1 = sortHand(deck.slice(0,17));
  const p2 = sortHand(deck.slice(17,34));
  const p3 = sortHand(deck.slice(34,51));
  const pile = sortHand(deck.slice(51)); // 3 bottom cards

  return [p1, p2, p3, pile];
}

// --- Room & game state ---
let roomList = {}; // { roomName: { playerId: readyState } } (playerId is socket.id)
let gameState = {}; // { roomName: { phase: string, hands: {playerId: []}, lastHand, turnOrder: [], turnIndex: 0, activePlayer, passCount: 0, landlordId: null, bottomPile: [], callIndex: 0 } }

// --- Import combo functions ---
// These functions live in the external 'game.js' file
const { getCombo, beats } = require('./game'); 

/**
 * Transitions the game to the playing phase, assigning the landlord and distributing bottom cards.
 * @param {string} room - The room name.
 * @param {string} landlordId - The socket ID of the new landlord.
 */
function finalizeLandlord(room, landlordId) {
    const state = gameState[room];
    if (!state) return;

    state.phase = 'PLAYING';
    state.landlordId = landlordId;
    
    // Add bottom pile to landlord's hand and re-sort
    state.hands[landlordId].push(...state.bottomPile);
    state.hands[landlordId] = sortHand(state.hands[landlordId]);

    // Set the landlord as the first active player
    state.activePlayer = landlordId;
    state.turnIndex = state.turnOrder.indexOf(landlordId);
    state.passCount = 0; // Reset pass count for the playing phase

    // 1. Inform the players of the result (via receive-message)
    const msg = `${landlordId} is the Landlord! Bottom cards: ${state.bottomPile.join(", ")}.`;
    io.in(room).emit("receive-message", msg);
    
    // 2. Inform the client to change phase controls (via receive-room-status)
    io.in(room).emit("receive-room-status", "Game has started. Playing phase active.");

    // Update the landlord's hand
    io.to(landlordId).emit("receive-cards", state.hands[landlordId]);
    
    // Notify all players of the turn start
    io.in(room).emit("turn-update", state.activePlayer);
}

io.on("connection", socket => {
  console.log(socket.id);

  // --- Chat ---
  socket.on("send-message", (msg, name, room) => {
    socket.to(room).emit("receive-message", `${name}: ${msg}`);
    socket.emit("receive-message", `${name}: ${msg}`);
  });

  // --- Join room ---
  socket.on("join-room", (room, name) => {
    socket.join(room);
    if (!roomList[room]) roomList[room] = {};
    roomList[room][name] = false;
    socket.to(room).emit("receive-room", `${name} joined.`);
    socket.emit("receive-room", `You joined room: ${room}`);
  });

  // --- Leave room ---
  socket.on("leave-room", (room, name) => {
    socket.leave(room);
    delete roomList[room][name];
    if (gameState[room]?.hands[name]) delete gameState[room].hands[name];
    socket.to(room).emit("receive-leave", `${name} left.`);
  });

  // --- Player ready / Game Start ---
  socket.on("send-status", async (room, name, status) => {
    roomList[room][name] = status;
    io.in(room).emit("receive-status", `${name} is ${status ? "ready" : "not ready"}.`);

    const readyPlayers = Object.entries(roomList[room]).filter(([_, v]) => v).map(([k,_]) => k);
    
    // Start Landlord Calling Phase if exactly 3 players are ready
    if (readyPlayers.length === 3) {
      io.in(room).emit("receive-room-status", "3 players ready! Starting Landlord calling phase...");
      
      const sockets = await io.in(room).fetchSockets();
      const playingSockets = sockets.filter(s => readyPlayers.includes(s.id));
      
      const cardList = dealCards();
      const turnOrder = playingSockets.map(s => s.id);
      
      gameState[room] = {
        phase: 'CALLING_LANDLORD',
        landlordId: null,
        hands: {},
        lastHand: null,
        turnOrder: turnOrder,
        turnIndex: 0,
        activePlayer: turnOrder[0],
        passCount: 0,
        bottomPile: cardList[3], // Store the 3 bottom cards
        callStatus: {}, // { playerId: 'call' or 'pass' }
        callIndex: 0
      };

      // Deal hands to the 3 playing sockets
      playingSockets.forEach((s, i) => {
        gameState[room].hands[s.id] = cardList[i];
        s.emit("receive-cards", cardList[i]);
      });

      io.in(room).emit("receive-message", `Calling starts! ${turnOrder[0]}'s turn to call.`);
      io.in(room).emit("turn-update", turnOrder[0]); // Start the calling phase turn
    }
  });

  // --- Call Landlord ---
  socket.on("call-landlord", (room, name, action) => {
    const state = gameState[room];
    if (!state || state.phase !== 'CALLING_LANDLORD') return socket.emit("receive-message", "Not in the calling phase.");
    if (socket.id !== state.activePlayer) return socket.emit("receive-message", "Not your turn to call.");

    state.callStatus[socket.id] = action; // 'call' or 'pass'
    
    io.in(room).emit("receive-message", `${name} chose to ${action === 'call' ? 'CALL LANDLORD' : 'PASS'}.`);

    if (action === 'call') {
      // First player to call becomes the Landlord instantly (simplified rule)
      return finalizeLandlord(room, socket.id);
    } 
    
    // If passed, move to next player
    state.callIndex++;
    
    if (state.callIndex >= state.turnOrder.length) {
      // All 3 players passed - Landlord is forced (simple rule) or game resets
      // Forcing the first player (turnOrder[0]) to be the Landlord if all pass
      io.in(room).emit("receive-message", "All players passed. Forcing the first player to be the Landlord.");
      return finalizeLandlord(room, state.turnOrder[0]);
    }
    
    // Next player's turn to call
    state.activePlayer = state.turnOrder[state.callIndex];
    io.in(room).emit("turn-update", state.activePlayer);
    io.in(room).emit("receive-message", `It's ${state.activePlayer}'s turn to call.`);
  });

  // --- Play hand ---
  socket.on("play-hand", (room, name, hand) => {
    const state = gameState[room];
    if (!state) return socket.emit("receive-message", "Game not started.");
    if (state.phase !== 'PLAYING') return socket.emit("receive-message", "Waiting for Landlord to be determined.");
    if (socket.id !== state.activePlayer) return socket.emit("receive-message", "Not your turn.");

    // Input card validation
    const playerHand = state.hands[socket.id];
    // Check if player has the cards
    const cardCounts = {};
    playerHand.forEach(card => cardCounts[card] = (cardCounts[card] || 0) + 1);
    const handCounts = {};
    hand.forEach(card => handCounts[card] = (handCounts[card] || 0) + 1);
    for (const card of hand) {
        if (!cardCounts[card] || handCounts[card] > cardCounts[card]) {
            return socket.emit("receive-message", `Error: You don't have enough '${card}' or the card is invalid.`);
        }
    }
    
    const sortedHand = sortHand(hand);
    const combo = getCombo(sortedHand); 

    if (!combo.valid) return socket.emit("receive-message", `Invalid hand type: ${combo.type}`);

    // Check if hand beats last hand (if there is one)
    if (state.lastHand) {
        if (state.lastHand.player === name) {
            return socket.emit("receive-message", "You cannot beat your own previous hand.");
        }
        
        // Pass card arrays to the 'beats' function
        if (!beats(state.lastHand.hand, sortedHand)) {
            return socket.emit("receive-message", "Your hand does not beat the last hand.");
        }
    }

    // Remove cards from player's hand
    sortedHand.forEach(c => {
      const idx = playerHand.indexOf(c);
      if (idx !== -1) playerHand.splice(idx, 1);
    });

    // Update last hand and reset pass count
    state.lastHand = { combo, hand: sortedHand, player: name };
    state.passCount = 0;

    const msg = `${name} played: ${sortedHand.join(", ")}. Remaining: ${playerHand.length}`;
    socket.emit("receive-message", msg);
    socket.to(room).emit("receive-message", msg);
    
    // Update the player's hand display
    socket.emit("receive-cards", playerHand);

    // Win check
    if (playerHand.length === 0) {
      const role = state.landlordId === socket.id ? 'Landlord' : 'Peasant';
      io.in(room).emit("receive-message", `${name} (${role}) wins the game!`);
      
      // --- GAME RESET LOGIC ---
      if (roomList[room]) {
          // Reset readiness status for all players in the roomList
          Object.keys(roomList[room]).forEach(playerId => {
              roomList[room][playerId] = false;
          });
          io.in(room).emit("receive-status", "All players reset to not ready.");
      }
      
      // Clear the game state
      delete gameState[room];
      
      // Inform clients to reset their UI and controls
      io.in(room).emit("game-over-reset");
      // --- END GAME RESET LOGIC ---
      
      return;
    }

    // Next turn
    state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
    state.activePlayer = state.turnOrder[state.turnIndex];
    io.in(room).emit("turn-update", state.activePlayer);
    io.in(room).emit("receive-message", `It's ${state.activePlayer}'s turn.`);
  });

  // --- Pass hand ---
  socket.on("pass-hand", (room, name) => {
    const state = gameState[room];
    if (!state) return socket.emit("receive-message", "Game not started.");
    if (state.phase !== 'PLAYING') return socket.emit("receive-message", "Waiting for Landlord to be determined.");
    if (socket.id !== state.activePlayer) return socket.emit("receive-message", "Not your turn.");
    if (!state.lastHand) return socket.emit("receive-message", "Cannot pass the first hand of the round.");
    
    // 1. Increment pass count
    state.passCount++;

    // 2. Check for reset condition (2 consecutive passes after a valid play)
    if (state.passCount >= 2) {
      io.in(room).emit("receive-message", `All other players have passed. The last hand is cleared.`);
      state.lastHand = null;
      state.passCount = 0; // Reset count
    }

    const msg = `${name} passed.`;
    socket.emit("receive-message", msg);
    socket.to(room).emit("receive-message", msg);

    // 3. Next turn
    state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
    state.activePlayer = state.turnOrder[state.turnIndex];
    io.in(room).emit("turn-update", state.activePlayer);
    io.in(room).emit("receive-message", `It's ${state.activePlayer}'s turn.`);
  });
});