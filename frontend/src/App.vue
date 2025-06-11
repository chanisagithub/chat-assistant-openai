<template>
  <VoiceAssistantIcon @toggle-ui="isVisible = !isVisible" />
  <VoiceAssistantUI v-if="isVisible" :config="config" @close-ui="isVisible = false" />
</template>

<script setup>
import { ref } from 'vue';
import VoiceAssistantIcon from './components/VoiceAssistantIcon.vue';
import VoiceAssistantUI from './components/VoiceAssistantUI.vue';
import config from './config.js';

const isVisible = ref(false);
</script>

<style scoped>
/* Any global styles for the app can go here if needed */
</style>