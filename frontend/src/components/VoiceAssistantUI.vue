<template>
  <div class="voice-assistant-plugin">
    <div class="assistant-header">
      <div class="title">AI Voice Assistant</div>
      <button class="close-button" @click="$emit('close-ui')">×</button>
    </div>

    <div class="status-container">
      <div class="status-indicator" :class="{ active: isConnected }">
        <div class="wave-container" v-if="isConnected">
          <div class="wave wave1"></div>
          <div class="wave wave2"></div>
          <div class="wave wave3"></div>
        </div>
        <div class="status-dot" v-else></div>
      </div>
      <div class="status-text">{{ status }}</div>
      <div class="error-text" v-if="error">{{ error }}</div>
    </div>

    <!-- Loading animation when initializing -->
    <div v-if="isInitializing" class="loading-container">
      <section class="dots-container">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </section>
      <div class="loading-text">Initializing Voice Assistant...</div>
    </div>

    <div v-else class="transcript-container">
      <div
        v-for="(message, index) in transcript"
        :key="index"
        :class="[
          'message',
          message.text.type === 'user' ? 'user-message' : 'assistant-message',
        ]"
      >
        <div class="message-bubble">
          <div class="message-content">{{ message.text.text }}</div>
          <!-- <div class="html-content" v-html="htmlContent"></div> -->
          <div
            v-if="message.type === 'assistant' && message.isSpeaking"
            class="audio-waveform"
          >
            <div class="bar" v-for="n in 5" :key="n"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="controls-container">
      <div class="voice-select-container">
        <label for="pluginVoiceSelect">Voice</label>
        <select
          v-if="config?.VOICES"
          id="pluginVoiceSelect"
          v-model="currentVoice"
          :disabled="!isReady"
        >
          <option v-for="voice in config.VOICES" :key="voice" :value="voice">
            {{ voice }}
          </option>
        </select>
      </div>

      <div class="button-group">
        <button
          class="control-button start-button"
          @click="startAssistant"
          :disabled="isConnected"
        >
          <span class="button-icon">▶</span>
          <span class="button-text">Start</span>
        </button>
        <button
          class="control-button stop-button"
          @click="stopAssistant"
          :disabled="!isConnected"
        >
          <span class="button-icon">■</span>
          <span class="button-text">Stop</span>
        </button>
        <button class="control-button clear-button" @click="clearTranscript">
          <span class="button-icon">✓</span>
          <span class="button-text">Clear</span>
        </button>

        <!-- Whatsapp Button -->
        <button class="control-button whatsapp-button" @click="openWhatsApp">
          <link
            href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css"
            rel="stylesheet"
          />
          <i class="mdi mdi-whatsapp" style="font-size: 36px; color: white"></i>
          <span class="button-text">WhatsApp</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import config from "../config.js";
import { ref, onMounted, onBeforeUnmount, watch, defineEmits } from "vue";

const transcript = ref([]);
const htmlContent = ref("");
const status = ref("Ready to start");
const error = ref("");
const isConnected = ref(false);
const isReady = ref(true);
const currentVoice = ref(config.VOICE || "alloy");
const isInitializing = ref(false);

// Assuming your app.js contains the App class, WebRTCManager, and ErrorHandler
import App from "../app.js";
let appInstance = null;

onMounted(() => {
  // Initialize the App instance when the component is mounted
  appInstance = new App(config, {
    updateTranscript: (message, type) => {
      const newMessage = {
        text: message,
        type,
        isSpeaking: type === "assistant",
      };

      transcript.value.unshift(newMessage);

      // Simulate the AI finishing speaking after a calculated time
      if (type === "assistant") {
        // Estimate speaking time based on message length (roughly 100ms per character)
        const speakTime = Math.max(1500, message.length * 80);

        setTimeout(() => {
          newMessage.isSpeaking = false;
        }, speakTime);
      }
    },
    updateStatus: (msg) => {
      status.value = msg;
    },
    showError: (msg) => {
      error.value = msg;
    },
    hideError: () => {
      error.value = "";
    },
    updateButtons: (connected) => {
      isConnected.value = connected;
    },
    updateVoiceSelector: (enabled) => {
      isReady.value = enabled;
    },
    updateHTML: (inputHtml, type) => {
      htmlContent.value = inputHtml;
    },
  });
});

watch(currentVoice, (newVoice) => {
  if (appInstance) {
    appInstance.handleVoiceChange(newVoice);
  }
});

onBeforeUnmount(() => {
  if (appInstance) {
    appInstance.disconnectPort();
    appInstance = null;
  }
});

const startAssistant = () => {
  if (appInstance) {
    isInitializing.value = true;
    appInstance.init();

    // Show loading animation for at least 2 seconds
    setTimeout(() => {
      isInitializing.value = false;
    }, 2000);
  }
};

const stopAssistant = () => {
  if (appInstance) {
    appInstance.stop();
  }
};

const clearTranscript = () => {
  transcript.value = [];
  if (appInstance && typeof appInstance.clearConversation === "function") {
    appInstance.clearConversation();
  }
};

const openWhatsApp = () => {
  const phoneNumber = "+94773685526"; // Replace with the actual phone number
  const message = encodeURIComponent("Hello, I need assistance!");
  const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;
  window.open(whatsappUrl, "_blank");
};

const emit = defineEmits(["close-ui"]);
</script>

<style>
.voice-assistant-plugin {
  position: fixed;
  bottom: 80px;
  right: 20px;
  z-index: 1000;
  background: linear-gradient(145deg, #f8f9fe, #ffffff);
  border: none;
  border-radius: 16px;
  padding: 0;
  width: 350px;
  max-height: 500px;
  overflow: hidden;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

.assistant-header {
  background: linear-gradient(90deg, #6a11cb, #8e43e7);
  color: white;
  padding: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-radius: 16px 16px 0 0;
}

.title {
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.5px;
}

.close-button {
  background: transparent;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  height: 24px;
  width: 24px;
  line-height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s;
}

.close-button:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.status-container {
  padding: 12px 15px;
  display: flex;
  align-items: center;
  background-color: #f5f7ff;
  border-bottom: 1px solid #eaeef9;
}

.status-indicator {
  margin-right: 10px;
  position: relative;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #c1c9d6;
}

.status-indicator.active .status-dot {
  background-color: #8e43e7;
}

.wave-container {
  width: 20px;
  height: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.wave {
  position: absolute;
  background: rgba(142, 67, 231, 0.4);
  border-radius: 50%;
  animation: wave 2s infinite;
}

.wave1 {
  width: 20px;
  height: 20px;
  animation-delay: 0s;
}

.wave2 {
  width: 15px;
  height: 15px;
  animation-delay: 0.3s;
  background: rgba(142, 67, 231, 0.6);
}

.wave3 {
  width: 10px;
  height: 10px;
  animation-delay: 0.6s;
  background: rgba(142, 67, 231, 0.8);
}

@keyframes wave {
  0% {
    transform: scale(0.4);
    opacity: 1;
  }

  100% {
    transform: scale(1.2);
    opacity: 0;
  }
}

.status-text {
  font-size: 14px;
  color: #596780;
}

.error-text {
  color: #ff5252;
  font-size: 14px;
  margin-left: 10px;
}

/* Loading animation styles */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 250px;
  background-color: white;
}

.dots-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60px;
  width: 100%;
  margin-bottom: 20px;
}

.dot {
  height: 20px;
  width: 20px;
  margin-right: 10px;
  border-radius: 10px;
  background-color: #b3d4fc;
  animation: pulse 1.5s infinite ease-in-out;
}

.dot:last-child {
  margin-right: 0;
}

.dot:nth-child(1) {
  animation-delay: -0.3s;
}

.dot:nth-child(2) {
  animation-delay: -0.1s;
}

.dot:nth-child(3) {
  animation-delay: 0.1s;
}

.dot:nth-child(4) {
  animation-delay: 0.3s;
}

.dot:nth-child(5) {
  animation-delay: 0.5s;
}

@keyframes pulse {
  0% {
    transform: scale(0.8);
    background-color: #b3d4fc;
    box-shadow: 0 0 0 0 rgba(178, 212, 252, 0.7);
  }

  50% {
    transform: scale(1.2);
    background-color: #6793fb;
    box-shadow: 0 0 0 10px rgba(178, 212, 252, 0);
  }

  100% {
    transform: scale(0.8);
    background-color: #b3d4fc;
    box-shadow: 0 0 0 0 rgba(178, 212, 252, 0.7);
  }
}

.loading-text {
  font-size: 14px;
  color: #596780;
  font-weight: 500;
}

.transcript-container {
  padding: 15px;
  height: 250px;
  overflow-y: auto;
  background-color: white;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
}

.message {
  padding: 10px 12px;
  border-radius: 12px;
  max-width: 85%;
  word-break: break-word;
  position: relative;
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.assistant-message {
  align-self: flex-start;
  background-color: #f3eeff;
  border-bottom-left-radius: 4px;
  color: #333;
}

.user-message {
  align-self: flex-end;
  background-color: #6a11cb;
  border-bottom-right-radius: 4px;
  color: white;
  margin-left: auto;
}

.message-content {
  font-size: 14px;
  line-height: 1.4;
}

/* Audio waveform animation */
.audio-waveform {
  display: flex;
  align-items: flex-end;
  height: 20px;
  margin-top: 8px;
  justify-content: center;
}

.audio-waveform .bar {
  width: 4px;
  background-color: #8e43e7;
  margin: 0 2px;
  border-radius: 2px;
  animation: sound 0.8s linear infinite alternate;
}

.audio-waveform .bar:nth-child(1) {
  animation-delay: 0ms;
  height: 2px;
}

.audio-waveform .bar:nth-child(2) {
  animation-delay: 150ms;
  height: 5px;
}

.audio-waveform .bar:nth-child(3) {
  animation-delay: 300ms;
  height: 8px;
}

.audio-waveform .bar:nth-child(4) {
  animation-delay: 450ms;
  height: 6px;
}

.audio-waveform .bar:nth-child(5) {
  animation-delay: 600ms;
  height: 3px;
}

@keyframes sound {
  0% {
    transform: scaleY(0.5);
    opacity: 0.5;
  }

  100% {
    transform: scaleY(1.8);
    opacity: 1;
  }
}

.controls-container {
  padding: 15px;
  background-color: #f8f9fe;
  border-top: 1px solid #eaeef9;
}

.voice-select-container {
  margin-bottom: 12px;
}

.voice-select-container label {
  display: block;
  margin-bottom: 5px;
  font-size: 13px;
  color: #596780;
  font-weight: 500;
}

#pluginVoiceSelect {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #e0e7ff;
  background-color: white;
  font-size: 14px;
  color: #333;
  transition: border-color 0.2s;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23596780'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 20px;
}

#pluginVoiceSelect:focus {
  outline: none;
  border-color: #8e43e7;
}

.button-group {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.control-button {
  border: none;
  border-radius: 50%;
  width: 50px;
  height: 50px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  background-color: white;
  color: #6a11cb;
  box-shadow: 0 3px 8px rgba(142, 67, 231, 0.2);
  position: relative;
  overflow: hidden;
}

.control-button::after {
  content: "";
  position: absolute;
  width: 100%;
  height: 100%;
  background: radial-gradient(
    circle,
    rgba(142, 67, 231, 0.1) 0%,
    rgba(255, 255, 255, 0) 70%
  );
  opacity: 0;
  transition: opacity 0.3s;
}

.control-button:hover::after {
  opacity: 1;
}

.button-icon {
  font-size: 18px;
  z-index: 1;
}

.button-text {
  position: absolute;
  bottom: -24px;
  font-size: 11px;
  color: #596780;
  font-weight: 500;
  opacity: 0;
  transition:
    opacity 0.3s,
    transform 0.3s;
  transform: translateY(-5px);
  white-space: nowrap;
}

.control-button:hover .button-text {
  opacity: 1;
  transform: translateY(0);
}

.start-button {
  border: 2px solid #8e43e7;
}

.start-button:hover:not(:disabled) {
  background-color: #f3eeff;
  transform: translateY(-2px);
}

.stop-button {
  border: 2px solid #ff5252;
  color: #ff5252;
}

.stop-button:hover:not(:disabled) {
  background-color: #fff5f5;
  transform: translateY(-2px);
}

.clear-button {
  border: 2px solid #8195a0;
  color: #8195a0;
}

.clear-button:hover:not(:disabled) {
  background-color: #f5f7fa;
  transform: translateY(-2px);
}

.control-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 10px;
}

::-webkit-scrollbar-thumb {
  background: #d4c2f0;
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: #8e43e7;
}

.whatsapp-button {
  background-color: #25d366;
  color: white;
}

.whatsapp-button:hover {
  background-color: #1ebc57;
}
</style>
