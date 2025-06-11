import { createApp } from 'vue';
import { defineCustomElement } from 'vue';
import VoiceAssistantUI from './components/VoiceAssistantUI.vue';
import App from './App.vue';

// Mount the main App component to the #app element
createApp(App).mount('#app');

// Register VoiceAssistantUI as a custom element
defineCustomElement('voice-assistant-ui', VoiceAssistantUI);

// Keep the mountPlugin function if you have a specific embedding use case for the entire App
const mountPlugin = (elementId = 'voice-assistant-widget') => {
    const el = document.getElementById(elementId)
    if (!el) {
      console.error(`[VoiceAssistantPlugin] Element with ID '${elementId}' not found.`)
      return
    }

    createApp(App).mount(el)
}

window.mountVoiceAssistant = mountPlugin;