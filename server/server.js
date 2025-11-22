const http = require('http'); // Import HTTP module
// The port is set by the hosting environment (like Render), 
// or defaults to 6969 for local development.
const PORT = process.env.PORT || 6969; 

// Create an HTTP server first
const server = http.createServer((req, res) => {
    // This is a minimal HTTP handler for the Render health check
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Doudizhu Socket Server is Running');
});

// Attach Socket.IO to the HTTP server
const io = require('socket.io')(server, {
  cors: { origin: "*" }
});
// REQUIRED FOR PINGING EXTERNAL URLS
const https = require('https');

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

// --- Global state management using Persistent User IDs (userId) ---
// roomList: { roomName: { userId: readyState } }
let roomList = {}; 
// gameState: { roomName: { ... hands: {userId: []}, ... turnOrder: [userId, ...], landlordId: userId } }
let gameState = {}; 

// --- Mapping between ephemeral Socket IDs and Persistent User IDs ---
// This is essential for addressing the correct socket when sending targeted messages
let socketIdToUserId = {}; // { socket.id: userId }
let userIdToSocketId = {}; // { userId: socket.id }

// --- Import combo functions ---
// These functions live in the external 'game.js' file
const { getCombo, beats } = require('./game'); 

/**
 * Transitions the game to the playing phase, assigning the landlord and distributing bottom cards.
 * @param {string} room - The room name.
 * @param {string} landlordId - The persistent User ID of the new landlord.
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

    // Update the landlord's hand (Target by userId)
    const landlordSocketId = userIdToSocketId[landlordId];
    if (landlordSocketId) {
        io.to(landlordSocketId).emit("receive-cards", state.hands[landlordId]);
    }
    
    // Notify all players of the turn start
    io.in(room).emit("turn-update", state.activePlayer);
}

io.on("connection", socket => {
  console.log(`Socket connected: ${socket.id}`);
  
  // Clean up mappings on disconnect
  socket.on("disconnect", () => {
    const userId = socketIdToUserId[socket.id];
    if (userId) {
        delete userIdToSocketId[userId];
        delete socketIdToUserId[socket.id];
        // Note: We don't remove from roomList here, allowing the user to reconnect if needed.
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });

  // --- Chat ---
  // The 'name' here is the persistent userId
  socket.on("send-message", (msg, userId, room) => {
    socket.to(room).emit("receive-message", `${userId}: ${msg}`);
    socket.emit("receive-message", `${userId}: ${msg}`);
  });

  // --- Join room ---
  // Now receives the persistent userId
  socket.on("join-room", (room, userId) => {
    socket.join(room);
    
    // Update mappings
    socketIdToUserId[socket.id] = userId;
    userIdToSocketId[userId] = socket.id;

    if (!roomList[room]) roomList[room] = {};
    // Store status using userId, keeping previous status if user reconnects
    roomList[room][userId] = roomList[room][userId] || false; 
    
    socket.to(room).emit("receive-room", `${userId} joined.`);
    socket.emit("receive-room", `You joined room: ${room}`);
  });

  // --- Leave room ---
  // Now uses persistent userId
  socket.on("leave-room", (room, userId) => {
    socket.leave(room);
    if (roomList[room]) {
        delete roomList[room][userId];
    }
    if (gameState[room]?.hands[userId]) {
        delete gameState[room].hands[userId];
    }
    socket.to(room).emit("receive-leave", `${userId} left.`);
  });

  // --- Player ready / Game Start ---
  // Now uses persistent userId
  socket.on("send-status", async (room, userId, status) => {
    if (!roomList[room] || !userIdToSocketId[userId]) {
        return socket.emit("receive-message", "Error: Not properly joined or connected.");
    }
    
    roomList[room][userId] = status;
    io.in(room).emit("receive-status", `${userId} is ${status ? "ready" : "not ready"}.`);

    // readyPlayers are persistent user IDs
    const readyPlayers = Object.entries(roomList[room]).filter(([_, v]) => v).map(([k,_]) => k);
    
    // Start Landlord Calling Phase if exactly 3 players are ready
    if (readyPlayers.length === 3) {
      io.in(room).emit("receive-room-status", "3 players ready! Starting Landlord calling phase...");
      
      // Get the current socket objects associated with the ready User IDs
      const playingSockets = readyPlayers
        .map(id => io.sockets.sockets.get(userIdToSocketId[id]))
        .filter(s => s); // Filter out any players who might have disconnected right before the start
      
      const cardList = dealCards();
      const turnOrder = readyPlayers; // turnOrder uses persistent User IDs
      
      gameState[room] = {
        phase: 'CALLING_LANDLORD',
        landlordId: null,
        hands: {}, // Keys are userId
        lastHand: null,
        turnOrder: turnOrder,
        turnIndex: 0,
        activePlayer: turnOrder[0],
        passCount: 0,
        bottomPile: cardList[3], 
        callStatus: {}, 
        callIndex: 0
      };

      // Deal hands using persistent User IDs
      readyPlayers.forEach((id, i) => {
        gameState[room].hands[id] = cardList[i];
        const playerSocketId = userIdToSocketId[id];
        if (playerSocketId) {
            io.to(playerSocketId).emit("receive-cards", cardList[i]);
        }
      });

      io.in(room).emit("receive-message", `Calling starts! ${turnOrder[0]}'s turn to call.`);
      io.in(room).emit("turn-update", turnOrder[0]); // Start the calling phase turn
    }
  });

  // --- Call Landlord ---
  // Now uses persistent userId
  socket.on("call-landlord", (room, userId, action) => {
    const state = gameState[room];
    if (!state || state.phase !== 'CALLING_LANDLORD') return socket.emit("receive-message", "Not in the calling phase.");
    if (userId !== state.activePlayer) return socket.emit("receive-message", "Not your turn to call.");

    state.callStatus[userId] = action; // 'call' or 'pass'
    
    io.in(room).emit("receive-message", `${userId} chose to ${action === 'call' ? 'CALL LANDLORD' : 'PASS'}.`);

    if (action === 'call') {
      // Landlord is the persistent userId
      return finalizeLandlord(room, userId);
    } 
    
    // If passed, move to next player
    state.callIndex++;
    
    if (state.callIndex >= state.turnOrder.length) {
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
  // Now uses persistent userId
  socket.on("play-hand", (room, userId, hand) => {
    const state = gameState[room];
    if (!state) return socket.emit("receive-message", "Game not started.");
    if (state.phase !== 'PLAYING') return socket.emit("receive-message", "Waiting for Landlord to be determined.");
    if (userId !== state.activePlayer) return socket.emit("receive-message", "Not your turn.");

    // Input card validation
    const playerHand = state.hands[userId];
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
        if (state.lastHand.player === userId) { // Check against persistent userId
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
    state.lastHand = { combo, hand: sortedHand, player: userId }; // Store persistent userId
    state.passCount = 0;

    const msg = `${userId} played: ${sortedHand.join(", ")}. Remaining: ${playerHand.length}`;
    socket.emit("receive-message", msg);
    socket.to(room).emit("receive-message", msg);
    
    // Update the player's hand display
    socket.emit("receive-cards", playerHand);

    // Win check
    if (playerHand.length === 0) {
      const role = state.landlordId === userId ? 'Landlord' : 'Peasant';
      io.in(room).emit("receive-message", `${userId} (${role}) wins the game!`);
      
      // --- GAME RESET LOGIC ---
      if (roomList[room]) {
          // Reset readiness status for all players in the roomList (which uses userId keys)
          Object.keys(roomList[room]).forEach(playerUserId => {
              roomList[room][playerUserId] = false;
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
    state.activePlayer = state.turnOrder[state.turnIndex]; // activePlayer is userId
    io.in(room).emit("turn-update", state.activePlayer);
    io.in(room).emit("receive-message", `It's ${state.activePlayer}'s turn.`);
  });

  // --- Pass hand ---
  // Now uses persistent userId
  socket.on("pass-hand", (room, userId) => {
    const state = gameState[room];
    if (!state) return socket.emit("receive-message", "Game not started.");
    if (state.phase !== 'PLAYING') return socket.emit("receive-message", "Waiting for Landlord to be determined.");
    if (userId !== state.activePlayer) return socket.emit("receive-message", "Not your turn.");
    if (!state.lastHand) return socket.emit("receive-message", "Cannot pass the first hand of the round.");
    
    // 1. Increment pass count
    state.passCount++;

    // 2. Check for reset condition (2 consecutive passes after a valid play)
    if (state.passCount >= 2) {
      io.in(room).emit("receive-message", `All other players have passed. The last hand is cleared.`);
      state.lastHand = null;
      state.passCount = 0; // Reset count
    }

    const msg = `${userId} passed.`;
    socket.emit("receive-message", msg);
    socket.to(room).emit("receive-message", msg);

    // 3. Next turn
    state.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
    state.activePlayer = state.turnOrder[state.turnIndex]; // activePlayer is userId
    io.in(room).emit("turn-update", state.activePlayer);
    io.in(room).emit("receive-message", `It's ${state.activePlayer}'s turn.`);
  });
});

// --- RENDER WAKE-UP PING LOGIC ---

function startPinging() {
    const url = 'https://doudizhu-eo39.onrender.com';
    const interval = 10 * 60 * 1000; // 10 minutes

    console.log(`Starting scheduled pings to ${url} every ${interval / 1000 / 60} minutes.`);

    setInterval(() => {
        https.get(url, (res) => {
            // Consume the response data to free up memory
            res.on('data', (chunk) => { /* do nothing */ }); 
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log(`[Ping Success] ${url} (Status: ${res.statusCode})`);
                } else {
                    console.warn(`[Ping Warning] ${url} (Status: ${res.statusCode})`);
                }
            });
        }).on('error', (err) => {
            console.error(`[Ping Failed] ${url}: ${err.message}`);
        });
    }, interval);
}

// Start the pinging process when the server script runs
startPinging();

// Start the HTTP server on the designated port
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});