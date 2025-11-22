        let room = '';
        let status = false; // ready status
        let name; // Stores the socket.id
        let socket;
        
        // Helper to update the log display
        function display(message) {
            const displayElement = document.getElementById('display');
            displayElement.innerHTML += (message + "\n");
            // Auto-scroll to the bottom
            displayElement.scrollTop = displayElement.scrollHeight;
        }

        // --- Socket Initialization ---
        // Note: Replace 'http://localhost:6969' with your actual server address if deployed
        socket = io('https://doudizhu-eo39.onrender.com:6969'); 

        // --- Socket Listeners ---
        socket.on('connect', () => {
            name = String(socket.id);
            document.getElementById('client-id').textContent = name;
            display(`Connected. Your ID: ${name}`);
        });

        socket.on("receive-message", display);
        socket.on("receive-room", display);
        socket.on("receive-room-status", display);
        socket.on("receive-status", display);
        socket.on("receive-leave", display);
        
        // Display the received hand
        socket.on("receive-cards", hand => {
            const handString = hand.join(', ');
            document.getElementById('current-hand').textContent = handString;
            display(`\n🃏 Your new hand: ${handString}`);
        });

        // Turn management and control enabling/disabling
        socket.on("turn-update", (activePlayerId) => {
            const isMyTurn = socket.id === activePlayerId;
            const turnDisplay = document.getElementById('turn-status');
            
            // Get references to control elements
            const controls = document.getElementById('call-controls');
            const playButton = document.getElementById('play');
            const passButton = document.getElementById('pass');

            if (controls.style.display === 'flex') {
                // Landlord Calling Phase
                document.getElementById('call-landlord').disabled = !isMyTurn;
                document.getElementById('pass-call').disabled = !isMyTurn;
                playButton.disabled = true;
                passButton.disabled = true;
                document.getElementById('input').disabled = !isMyTurn;
            } else {
                // Playing Phase
                playButton.disabled = !isMyTurn;
                passButton.disabled = !isMyTurn;
                document.getElementById('input').disabled = !isMyTurn;
            }
            
            if (isMyTurn) {
                display("\n➡️ It's your turn! Play or Pass.");
            } else {
                display(`\n⏳ Waiting for ${activePlayerId}...`);
            }
        });

        socket.on("receive-room-status", (message) => {
            display(message);
            if (message.includes("Starting Landlord calling phase")) {
                // Hide ready/join controls, show calling controls
                document.getElementById('join').style.display = 'none';
                document.getElementById('room').style.display = 'none';
                document.getElementById('leave').style.display = 'none';
                document.getElementById('status').style.display = 'none';
                document.getElementById('call-controls').style.display = 'flex';
                
                // Disable playing controls during calling
                document.getElementById('play').disabled = true;
                document.getElementById('pass').disabled = true;
            } else if (message.includes("Game has started. Playing phase active.")) {
                // Correct signal from the server to start the playing phase.
                document.getElementById('call-controls').style.display = 'none';
                // The subsequent 'turn-update' event will now correctly enable Play/Pass buttons for the Landlord.
            }
        });
        
        // --- NEW RESET LISTENER ---
        socket.on("game-over-reset", () => {
            // Note: The player is NOT leaving the room, just resetting their readiness status.
            display("\n--- Game Over. You are now NOT READY. Press 'Ready' to start the next game. ---");
            
            // 1. Reset client-side state
            status = false; 
            
            // 2. Reset UI elements
            document.getElementById('current-hand').textContent = "None (Join a room / Get Ready)";
            document.getElementById('input').value = '';
            
            // 3. Hide game-specific controls
            document.getElementById('call-controls').style.display = 'none';
            document.getElementById('play').disabled = true;
            document.getElementById('pass').disabled = true;
            document.getElementById('input').disabled = true;

            // 4. Show ready/leave controls again
            document.getElementById('status').style.display = 'inline-block';
            document.getElementById('status').innerHTML = "Ready"; // Reset button text
            document.getElementById('leave').style.display = 'inline-block';
        });
        
        // --- Button Event Listeners ---

        // Join Room
        document.getElementById('join').addEventListener('click', () => {
            room = document.getElementById('room').value.trim();
            if (room) {
                socket.emit("join-room", room, name);
                document.getElementById('leave').style.display = 'inline-block';
                document.getElementById('status').style.display = 'inline-block';
                document.getElementById('join').style.display = 'none';
                document.getElementById('room').style.display = 'none';
            } else {
                display("Please enter a room name.");
            }
        });

        // Leave Room
        document.getElementById('leave').addEventListener('click', () => {
            if (room) socket.emit("leave-room", room, name);
            room = '';
            status = false;
            document.getElementById('leave').style.display = 'none';
            document.getElementById('status').style.display = 'none';
            document.getElementById('join').style.display = 'inline-block';
            document.getElementById('room').style.display = 'inline-block';
            document.getElementById('call-controls').style.display = 'none';
            document.getElementById('status').innerHTML = "Ready";
            document.getElementById('current-hand').textContent = "None (Join a room)";
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
            if (message) {
                // Clear input after sending chat
                document.getElementById('input').value = ''; 
                socket.emit("send-message", message, name, room);
            }
        });
        
        // --- Landlord Calling Actions ---
        document.getElementById('call-landlord').addEventListener('click', () => {
            socket.emit("call-landlord", room, name, 'call');
            // Disable calling buttons once action is sent
            document.getElementById('call-landlord').disabled = true;
            document.getElementById('pass-call').disabled = true;
        });

        document.getElementById('pass-call').addEventListener('click', () => {
            socket.emit("call-landlord", room, name, 'pass');
            // Disable calling buttons once action is sent
            document.getElementById('call-landlord').disabled = true;
            document.getElementById('pass-call').disabled = true;
        });
        
        // --- Playing Actions ---
        
        // Play Hand
        document.getElementById('play').addEventListener('click', () => {
            const handInput = document.getElementById('input').value.trim();
            if (handInput) {
                // Split input by comma, handle potential spaces
                const hand = handInput.split(',').map(c => c.trim()).filter(c => c.length > 0);
                if (hand.length > 0) {
                    socket.emit("play-hand", room, name, hand);
                    document.getElementById('input').value = ''; // Clear input field
                } else {
                    display("Please enter valid cards to play.");
                }
            } else {
                 display("Please enter cards to play or chat message.");
            }
        });

        // Pass Hand
        document.getElementById('pass').addEventListener('click', () => {
            socket.emit("pass-hand", room, name);
        });