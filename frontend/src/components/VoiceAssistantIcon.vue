<template>
  <div class="voice-assistant-icon" @click="$emit('toggle-ui')">
    <div class="icon-inner">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        width="24"
        height="24"
      >
        <path
          d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3z"
        ></path>
        <path
          d="M17 12c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"
        ></path>
      </svg>
    </div>
    <div class="pulse-ring"></div>
  </div>
</template>

<script setup>
  defineEmits(["toggle-ui"]);
</script>

<style>
.voice-assistant-icon {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 4px 10px rgba(106, 17, 203, 0.3));
  transition: transform 0.3s, filter 0.3s;
}

.icon-inner {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(145deg, #8e43e7, #6a11cb);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.5em;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  position: relative;
  z-index: 2;
  transition: transform 0.3s, box-shadow 0.3s;
}

.voice-assistant-icon:hover .icon-inner {
  transform: scale(1.05);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
}

.voice-assistant-icon:active .icon-inner {
  transform: scale(0.95);
}

.pulse-ring {
  position: absolute;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background-color: rgba(142, 67, 231, 0.3);
  z-index: 1;
  opacity: 0;
  transform: scale(0.8);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0.8);
    opacity: 0.6;
  }
  70% {
    transform: scale(1.2);
    opacity: 0;
  }
  100% {
    transform: scale(0.8);
    opacity: 0;
  }
}

svg {
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
}
</style>
