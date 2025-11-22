let room = '';
let status = false;
let name;
function display(message) {
  document.getElementById('display').innerHTML += (message + "\n");
}

socket = io('http://localhost:6969')

socket.on('connect', () => {
  document.getElementById('display').innerHTML += socket.id
  name = String(socket.id);
})
socket.on("receive-message", message => {
  display(message)
})
socket.on("receive-room", message => {
  display(message)
})
socket.on("receive-room-status", message => {
  display(message)
})
socket.on("receive-status", message => {
  display(message)
})
socket.on("receive-leave", message => {
  display(message)
})
socket.on("receive-cards", message => {
  display(message)
})

document.getElementById('send').addEventListener('click', () => {
  const message = document.getElementById('input').value;
  socket.emit("send-message", message, name, room)
  display(message)
});

document.getElementById('join').addEventListener('click', () => {
  room = document.getElementById('room').value;
  socket.emit("join-room", room, name)
  hasJoinedRoom = true;
  document.getElementById('leave').style.display = 'inline-block'
  document.getElementById('status').style.display = 'inline-block'
  document.getElementById('join').style.display = 'none'
  document.getElementById('room').style.display = 'none'
  display(room)
});

document.getElementById('leave').addEventListener('click', () => {
    socket.emit("leave-room", room, name)
    hasJoinedRoom = false;
    document.getElementById('leave').style.display = 'none'
    document.getElementById('status').style.display = 'none'
    document.getElementById('join').style.display = 'inline-block'
    document.getElementById('room').style.display = 'inline-block'
    display(`You have left the room.`)
});

document.getElementById('status').addEventListener('click', () => {
  if (status) {
    status = false;
    document.getElementById('status').innerHTML = "Ready";
    socket.emit("send-status", room, name, status)
    display(`You are not ready.`)
  } else {
    status = true;
    document.getElementById('status').innerHTML = "Not Ready";
    socket.emit("send-status", room, name, status)
    display(`You are ready.`)
  }

});

