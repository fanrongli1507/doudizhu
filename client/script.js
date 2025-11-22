// NOTE: If deploying to Render, you must replace 'http://localhost:6969' 
// with your deployed URL (e.g., 'https://doudizhu-eo39.onrender.com').
const LOCAL_URL = 'https://doudizhu-eo39.onrender.com';

let room = '';
let status = false; // ready status
let name; // Stores the ephemeral socket.id
let socket;

// --- Card State Management ---
let currentHand = [];
let selectedCards = [];

// Utility map for card color display
const redCards = ["10", "A", "K", "Q", "J", "Black Joker", "Red Joker"];

// Helper to update the log display
function display(message) {
  const displayElement = document.getElementById('display');
  displayElement.innerHTML += (message + "\n");
  displayElement.scrollTop = displayElement.scrollHeight;
}

// --- Card Rendering Logic ---

/**
 * Renders the player's current hand as clickable elements.
 */
function renderHand() {
  const handContainer = document.getElementById('hand-container');
  handContainer.innerHTML = ''; // Clear existing cards

  if (currentHand.length === 0) {
    handContainer.innerHTML = '<p class="text-gray-500">Hand is empty.</p>';
    return;
  }

  // Reverse the hand for rendering (highest value on the right)
  currentHand.forEach(cardName => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.textContent = cardName;
    cardDiv.dataset.card = cardName;

    // Set text color based on card type for visual appeal
    if (redCards.includes(cardName) || cardName.includes("Joker")) {
      cardDiv.classList.add('text-red-600');
    } else {
      cardDiv.classList.add('text-black');
    }

    // Check if this card is currently selected and apply styling
    if (selectedCards.includes(cardName)) {
      cardDiv.classList.add('card-selected');
    }

    cardDiv.addEventListener('click', toggleCardSelection);
    handContainer.appendChild(cardDiv);
  });

  updateSelectedDisplay();
}

/**
 * Toggles the selection status of a card when clicked.
 * NOTE: This allows selecting multiple cards with the same value (e.g., two 3s)
 */
function toggleCardSelection(event) {
  const cardDiv = event.currentTarget;
  const cardName = cardDiv.dataset.card;

  // This is a robust way to find the specific instance of the card in the selected array.
  // When selecting, we always add. When deselecting, we find the first instance and remove it.

  if (cardDiv.classList.contains('card-selected')) {
    // Deselect the card: remove from array and update style
    const index = selectedCards.indexOf(cardName);
    if (index > -1) {
      selectedCards.splice(index, 1);
    }
    cardDiv.classList.remove('card-selected');
  } else {
    // Select the card: add to array and update style
    selectedCards.push(cardName);
    cardDiv.classList.add('card-selected');
  }

  updateSelectedDisplay();
  // Re-check button status since selection changed
  updateActionButtons();
}

/**
 * Updates the visual display of selected cards.
 */
function updateSelectedDisplay() {
  const displayElement = document.getElementById('selected-hand-display');
  // Sort selected cards to display them nicely
  const sortedSelection = selectedCards.slice().sort((a, b) => {
    const map = { "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14, "2": 15, "Black Joker": 16, "Red Joker": 17 };
    return map[a] - map[b];
  });

  if (sortedSelection.length > 0) {
    displayElement.textContent = sortedSelection.join(', ');
  } else {
    displayElement.textContent = "None";
  }
}

/**
 * Enables/disables play and clear buttons based on selection and turn status.
 */
function updateActionButtons() {
  const playButton = document.getElementById('play');
  const clearButton = document.getElementById('clear-selection');
  const passButton = document.getElementById('pass');

  // Check if the pass button is disabled (this acts as the turn indicator)
  const isMyTurn = !passButton.disabled;

  // Play button is enabled if it's the turn AND cards are selected
  playButton.disabled = selectedCards.length === 0 || !isMyTurn;

  // Clear button is enabled if cards are selected
  clearButton.disabled = selectedCards.length === 0;
}

/**
 * Resets the selection state and redraws the hand.
 */
function clearSelection() {
  selectedCards = [];
  // Re-render the hand to remove 'card-selected' classes
  renderHand();
  updateActionButtons();
}

// --- Socket Initialization ---
socket = io(LOCAL_URL);

// --- Socket Listeners ---
socket.on('connect', () => {
  name = String(socket.id);
  document.getElementById('client-id').textContent = name;
  display(`Connected. Your Player ID: ${name}`);
});

socket.on("receive-message", display);
socket.on("receive-room", display);
socket.on("receive-room-status", display);
socket.on("receive-status", display);
socket.on("receive-leave", display);

// Receive and render the player's hand
socket.on("receive-cards", hand => {
  currentHand = hand;
  selectedCards = [];
  renderHand();
});

// Turn management
socket.on("turn-update", (activePlayerId) => {
  const isMyTurn = name === activePlayerId;

  const controls = document.getElementById('call-controls');
  const playButton = document.getElementById('play');
  const passButton = document.getElementById('pass');
  const clearButton = document.getElementById('clear-selection');
  const inputField = document.getElementById('input');

  // Set base turn state for playing buttons
  passButton.disabled = !isMyTurn;

  if (controls.style.display === 'flex') {
    // Landlord Calling Phase
    document.getElementById('call-landlord').disabled = !isMyTurn;
    document.getElementById('pass-call').disabled = !isMyTurn;

    // Disable playing controls entirely during calling
    playButton.disabled = true;
    clearButton.disabled = true;
  } else {
    // Playing Phase
    // Play and Clear buttons depend on selection AND turn
    updateActionButtons();
  }

  if (isMyTurn) {
    display("\n➡️ It's your turn! Select cards to play or Pass.");
  } else {
    display(`\n⏳ Waiting for ${activePlayerId}...`);
  }
});

socket.on("receive-room-status", (message) => {
  display(message);
  if (message.includes("Starting Landlord calling phase")) {
    // UI state transitions for calling
    document.getElementById('join').style.display = 'none';
    document.getElementById('room').style.display = 'none';
    document.getElementById('leave').style.display = 'none';
    document.getElementById('status').style.display = 'none';
    document.getElementById('call-controls').style.display = 'flex';

  } else if (message.includes("Game has started. Playing phase active.")) {
    // UI state transitions for playing
    document.getElementById('call-controls').style.display = 'none';
  }
});

// --- RESET LISTENER ---
socket.on("game-over-reset", () => {
  display("\n--- Game Over. You are now NOT READY. Press 'Ready' to start the next game. ---");

  // 1. Reset client-side state
  status = false;
  currentHand = [];
  selectedCards = [];

  // 2. Reset UI elements
  document.getElementById('hand-container').innerHTML = '<p class="text-gray-500">Your hand will appear here when the game starts.</p>';
  document.getElementById('selected-hand-display').textContent = "None";

  // 3. Hide game-specific controls
  document.getElementById('call-controls').style.display = 'none';
  document.getElementById('play').disabled = true;
  document.getElementById('pass').disabled = true;
  document.getElementById('clear-selection').disabled = true;

  // 4. Show ready/leave controls again
  document.getElementById('status').style.display = 'inline-block';
  document.getElementById('status').innerHTML = "Ready";
  document.getElementById('leave').style.display = 'inline-block';
});

// --- Button Event Listeners ---

// Join Room
document.getElementById('join').addEventListener('click', () => {
  room = document.getElementById('room').value.trim();
  if (room && name) {
    socket.emit("join-room", room, name); // Use ephemeral ID 'name'
    document.getElementById('leave').style.display = 'inline-block';
    document.getElementById('status').style.display = 'inline-block';
    document.getElementById('join').style.display = 'none';
    document.getElementById('room').style.display = 'none';
  } else {
    display("Please enter a room name and ensure you are connected.");
  }
});

// Leave Room
document.getElementById('leave').addEventListener('click', () => {
  if (room && name) socket.emit("leave-room", room, name);
  room = '';
  status = false;
  currentHand = [];
  selectedCards = [];
  document.getElementById('leave').style.display = 'none';
  document.getElementById('status').style.display = 'none';
  document.getElementById('join').style.display = 'inline-block';
  document.getElementById('room').style.display = 'inline-block';
  document.getElementById('call-controls').style.display = 'none';
  document.getElementById('status').innerHTML = "Ready";
  document.getElementById('hand-container').innerHTML = '<p class="text-gray-500">Your hand will appear here when the game starts.</p>';
  document.getElementById('selected-hand-display').textContent = "None";
  display(`You have left the room.`);
});

// Toggle Ready Status
document.getElementById('status').addEventListener('click', () => {
  status = !status;
  document.getElementById('status').innerHTML = status ? "Not Ready" : "Ready";
  socket.emit("send-status", room, name, status);
  display(`You are ${status ? 'ready' : 'not ready'}.`);
});

// Send Chat Message
document.getElementById('send').addEventListener('click', () => {
  const message = document.getElementById('input').value.trim();
  if (message && name) {
    document.getElementById('input').value = '';
    socket.emit("send-message", message, name, room);
  }
});

// --- Landlord Calling Actions ---
document.getElementById('call-landlord').addEventListener('click', () => {
  if (name) socket.emit("call-landlord", room, name, 'call');
  document.getElementById('call-landlord').disabled = true;
  document.getElementById('pass-call').disabled = true;
});

document.getElementById('pass-call').addEventListener('click', () => {
  if (name) socket.emit("call-landlord", room, name, 'pass');
  document.getElementById('call-landlord').disabled = true;
  document.getElementById('pass-call').disabled = true;
});

// --- Playing Actions ---

// Clear Selection Button
document.getElementById('clear-selection').addEventListener('click', clearSelection);

// Play Hand (Uses selectedCards state)
document.getElementById('play').addEventListener('click', () => {
  if (selectedCards.length > 0 && name) {
    // Send a copy of the selected cards
    const handToPlay = [...selectedCards];

    socket.emit("play-hand", room, name, handToPlay);

    // Clear the selection on the client side, regardless of server response
    clearSelection();
  } else {
    display("Please select cards to play.");
  }
});

// Pass Hand
document.getElementById('pass').addEventListener('click', () => {
  if (name) {
    clearSelection(); // Clear any selected cards before passing
    socket.emit("pass-hand", room, name);
  }
});