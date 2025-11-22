const io = require('socket.io')(6969, {
    cors: {
    origin: "*",
    }   // allow any website to connect
})
const order = {
  "3": 1, "4": 2, "5": 3, "6": 4, "7": 5,
  "8": 6, "9": 7, "10": 8, "J": 9, "Q": 10,
  "K": 11, "A": 12, "2": 13,
  "Black Joker": 14,
  "Red Joker": 15
};

function getValue(card) {
  if (card === "Black Joker" || card === "Red Joker") return order[card];
  return order[card.replace(/[^0-9JQKA]+/, "")]; // remove suit
}

function sortHand(hand) {
  return hand.sort((a, b) => getValue(a) - getValue(b));
}
function dealCards() {
  const shuffled = [
  '♠3','♠4','♠5','♠6','♠7','♠8','♠9','♠10','♠J','♠Q','♠K','♠A','♠2',
  '♥3','♥4','♥5','♥6','♥7','♥8','♥9','♥10','♥J','♥Q','♥K','♥A','♥2',
  '♣3','♣4','♣5','♣6','♣7','♣8','♣9','♣10','♣J','♣Q','♣K','♣A','♣2',
  '♦3','♦4','♦5','♦6','♦7','♦8','♦9','♦10','♦J','♦Q','♦K','♦A','♦2',
  'Black Joker','Red Joker'
];


  // Shuffle deck
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Deal
  const p1 = sortHand(shuffled.slice(0, 17));
  const p2 = sortHand(shuffled.slice(17, 34));
  const p3 = sortHand(shuffled.slice(34, 51));
  const pile = sortHand(shuffled.slice(51));

  return [p1, p2, p3, pile];
}
let roomList = {};

io.on("connection", socket => {
  console.log(socket.id)
  socket.leave(socket.id)
  socket.on("send-message", (message, name, room) => {
    socket.to(room).emit("receive-message", `${name}: ${message}`)
  })
  socket.on("join-room", (room, name) => {
    socket.join(room)
    if (!roomList[room]) roomList[room] = {};
    roomList[room][name] = false;
    console.log(roomList)
    socket.to(room).emit("receive-room", `${name} has joined the room.`)
  })
  socket.on("leave-room", (room, name) => {
    socket.leave(room)
    delete roomList[room][name]
    socket.to(room).emit("receive-leave", `${name} has left the room.`)
  })
  socket.on("send-status", async (room, name, status) => {
    roomList[room][name] = status;

    io.in(room).emit("receive-status", `${name} is ${status ? "ready" : "not ready"}.`);

    if (Object.values(roomList[room]).every(v => v === true)) {
      io.in(room).emit("receive-room-status", "Everyone is ready!");
      const sockets = await io.in(room).fetchSockets();
      const cardList = dealCards()

      sockets.forEach((s, index) => {
        s.emit("receive-cards", cardList[index]);
      });
    }
  });
})