// assistant-shared-worker.js

let CONFIG = null;
let ephemeralKey = null;
let currentVoiceForSession = null;
let globalSessionStatus = "idle"; // 'idle', 'initializing', 'key_fetched', 'master_assigned', 'connected', 'failed', 'stopped'
let masterClientPort = null; // The MessagePort of the client managing the actual WebRTC connection

const connectedPorts = new Set();

// --- ErrorHandler (simplified for worker context) ---
class ErrorHandler {
  static handle(error, context, portToNotify) {
    console.error(`SharedWorker Error in ${context}:`, error.message, error);
    const errorMessage = {
      type: 'WORKER_ERROR',
      payload: { context, message: error.message, details: error.stack }
    };
    if (portToNotify) {
      try { portToNotify.postMessage(errorMessage); } catch (e) { console.warn("Port closed, cannot send error.") }
    } else {
      broadcast(errorMessage);
    }
  }
}

function broadcast(message) {
  connectedPorts.forEach(port => {
    try {
      port.postMessage(message);
    } catch (e) {
      console.warn("Failed to post message to a port during broadcast, removing.", e);
      if (port === masterClientPort) masterClientPort = null; // Master disconnected
      connectedPorts.delete(port);
    }
  });
}

function updateGlobalSessionStatus(newStatus, additionalPayload = {}) {
  globalSessionStatus = newStatus;
  broadcast({ type: 'SESSION_STATUS_UPDATE', payload: { status: globalSessionStatus, voice: currentVoiceForSession, ...additionalPayload } });
}

async function handleRequestToStartSession(port, requestedVoice) {
  if (!CONFIG) {
    ErrorHandler.handle(new Error("CONFIG not set"), "StartSessionRequest", port);
    return;
  }

  // If a session is already active and voice is the same, just update new client
  if (masterClientPort && globalSessionStatus !== 'idle' && globalSessionStatus !== 'stopped' && globalSessionStatus !== 'failed' && currentVoiceForSession === requestedVoice) {
    console.log("SharedWorker: Session already active with this voice. Updating new client.");
    port.postMessage({ type: 'SESSION_STATUS_UPDATE', payload: { status: globalSessionStatus, voice: currentVoiceForSession, masterExists: true } });
    return;
  }

  // If there's another master, or voice changes, reset.
  if (masterClientPort && masterClientPort !== port || (masterClientPort && currentVoiceForSession !== requestedVoice)) {
    console.log("SharedWorker: New master request or voice change. Resetting previous session if any.");
    if (masterClientPort && masterClientPort !== port) { // Tell old master to stop
        try { masterClientPort.postMessage({ type: 'YOU_ARE_NO_LONGER_MASTER_STOP_YOUR_RTC' }); } catch(e){ console.warn("Old master port closed"); }
    }
    await resetSessionState("New master or voice change");
  }


  masterClientPort = port;
  currentVoiceForSession = requestedVoice;
  updateGlobalSessionStatus("initializing_session");

  try {
    const tokenResponse = await fetch(
      `${CONFIG.API_ENDPOINTS.session}?voice=${currentVoiceForSession}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "krabi_luxury_properties",
          property: {
            title: "Krabi Luxury Villas",
            location: "Krabi, Thailand",
            pricing: "$500,000 - $1,500,000",
            key_features: ["Ocean view", "Private pool", "Gated community"],
            additional_amenities: ["Gym", "Spa", "24/7 security"],
            buyer_persona: "High-net-worth individuals seeking luxury living",
          },
        }),
      },
    );
    if (!tokenResponse.ok) throw new Error(`Session token fetch failed: ${tokenResponse.statusText}`);
    const data = await tokenResponse.json();
    if (!data.client_secret?.value) throw new Error("client_secret not found");
    ephemeralKey = data.client_secret.value;

    updateGlobalSessionStatus("key_fetched_tell_master_to_offer");
    masterClientPort.postMessage({ type: 'PROCEED_AS_MASTER_CREATE_OFFER', payload: { voice: currentVoiceForSession } });

  } catch (error) {
    ErrorHandler.handle(error, "SessionInitialization", masterClientPort);
    await resetSessionState(`Error fetching key: ${error.message}`);
  }
}

async function handleOfferFromMaster(port, offerSdp) {
  if (port !== masterClientPort || !ephemeralKey) {
    ErrorHandler.handle(new Error("Not master or no key for offer"), "OfferFromMaster", port);
    if (port !== masterClientPort && masterClientPort) { // A non-master client sent an offer
        try { port.postMessage({type: 'ERROR', payload: {message: "You are not the master client for this session."}}); } catch(e) {}
    }
    return;
  }
  updateGlobalSessionStatus("exchanging_sdp");
  try {
    const sdpResponse = await fetch(CONFIG.API_ENDPOINTS.realtime, {
      method: 'POST',
      body: offerSdp, // Client sends just the SDP string
      headers: { Authorization: `Bearer ${ephemeralKey}`, 'Content-Type': 'application/sdp' },
    });
    if (!sdpResponse.ok) throw new Error(`SDP exchange failed: ${sdpResponse.statusText}`);
    const answerSdp = await sdpResponse.text();
    if (!answerSdp) throw new Error("Empty SDP answer from server");

    masterClientPort.postMessage({ type: 'ANSWER_FOR_MASTER_CLIENT', payload: { sdp: answerSdp } });
    updateGlobalSessionStatus("answer_sent_to_master");

  } catch (error) {
    ErrorHandler.handle(error, "SDPExchange", masterClientPort);
    await resetSessionState(`Error exchanging SDP: ${error.message}`);
  }
}

function handleMessageFromAIviaMaster(port, aiMessage) {
  if (port !== masterClientPort) return; // Only master should forward AI messages

  // Worker processes the AI message and broadcasts structured updates
  try {
    const message = JSON.parse(aiMessage); // Assuming master client sends it as a stringified JSON
    console.log("SharedWorker: Received from AI via Master:", message);

    // 1. Transcript Relaying
    const transcript = message.response?.output?.[0]?.content?.[0]?.transcript;
    if (transcript) {
      broadcast({ type: 'TRANSCRIPT_UPDATE', payload: { text: {text: transcript, type: "assistant"}, type: "assistant" }});
    }
    if (message.type === "conversation.item.input_audio_transcription.completed") {
      const userTranscript = message.transcript;
      broadcast({ type: 'TRANSCRIPT_UPDATE', payload: { text: {text: userTranscript, type: "user"}, type: "user" }});
      broadcast({ type: 'HTML_UPDATE', payload: { html: '<img src="https://www.simplilearn.com/ice9/free_resources_article_thumb/what_is_image_Processing.jpg" alt="Image" class="transcript-image" width="100"/>', type: "assistant" }});
    }

    // 2. Function Call Handling (Worker tells client to act or worker calls API if it can)
    if (message.type === "response.done") {
      const output = message.response?.output?.[0];
      if (output?.type === "function_call" && output?.call_id) {
        if (output.name === "open_whatsapp") {
          broadcast({ type: 'REQUEST_CLIENT_ACTION', payload: { action: 'open_whatsapp', data: output } });
          broadcast({ type: 'TRANSCRIPT_UPDATE', payload: { text: {text: "You can talk to an agent via WhatsApp...", type: "assistant"}, type: "assistant" }});
          // Master client should then send function output back via worker
        } else if (CONFIG.FUNCTION_HANDLERS_IN_WORKER && CONFIG.FUNCTION_HANDLERS_IN_WORKER[output.name]) {
            // If worker can handle it directly (e.g. fetch weather/search)
            CONFIG.FUNCTION_HANDLERS_IN_WORKER[output.name](output, broadcast, CONFIG, ephemeralKey /* if needed */)
                .then(result => {
                    if (masterClientPort) { // Tell master to send function output
                        masterClientPort.postMessage({ type: 'SEND_FUNCTION_RESULT_TO_AI', payload: { call_id: output.call_id, result: result }});
                    }
                })
                .catch(err => ErrorHandler.handle(err, `Worker Function ${output.name}`, null));
        } else {
             // Function needs to be handled by master client
             if (masterClientPort) {
                masterClientPort.postMessage({ type: 'MASTER_HANDLE_FUNCTION_CALL', payload: { functionCall: output } });
             }
        }
      }
    }
  } catch (error) {
    ErrorHandler.handle(error, "ProcessingAIMessage", masterClientPort);
  }
}

function handleClientMessageForAI(port, clientMessagePayload) {
    if (masterClientPort) {
        // Forward this message to the master client to send over its DataChannel
        try {
            masterClientPort.postMessage({ type: 'SEND_THIS_TO_AI_VIA_DC', payload: clientMessagePayload });
        } catch (e) {
            ErrorHandler.handle(new Error("Master client port closed, cannot relay message for AI."), "ClientMessageForAI", port);
            // Inform original sender
            if (port !== masterClientPort) {
                try { port.postMessage({type: 'ERROR', payload: {message: "Cannot send message, master client disconnected."}}); } catch(e2){}
            }
        }
    } else {
        ErrorHandler.handle(new Error("No master client to send message to AI."), "ClientMessageForAI", port);
        try { port.postMessage({type: 'ERROR', payload: {message: "No active session to send message."}}); } catch(e){}
    }
}


async function resetSessionState(reason = "Session reset") {
  console.log(`SharedWorker: Resetting session state. Reason: ${reason}`);
  ephemeralKey = null;
  // currentVoiceForSession = null; // Keep for UI consistency until next start
  if (masterClientPort) {
      try {
          masterClientPort.postMessage({ type: 'SESSION_TERMINATED_BY_WORKER_STOP_RTC' });
      } catch(e) { console.warn("Master port likely closed during reset", e); }
  }
  masterClientPort = null;
  updateGlobalSessionStatus("stopped", { reason });
}

// --- SharedWorker Lifecycle & Port Management ---
self.onconnect = (e) => {
  const port = e.ports[0];
  connectedPorts.add(port);
  console.log(`SharedWorker: Client connected. Total: ${connectedPorts.size}. Master: ${masterClientPort === port}`);

  port.onmessageerror = (err) => {
    console.error("SharedWorker: Error on port message:", err);
    // Consider removing port if messageerror occurs
  };

  // Cleanup when a port closes (implicitly by browser, or explicitly if possible)
  // This is not a standard event, but good to have a mechanism if a port becomes unresponsive
  const checkPort = setInterval(() => {
      try {
          port.postMessage({type: 'PING'}); // Check if port is alive
      } catch (closedError) {
          console.log("SharedWorker: Port seems closed, removing.");
          connectedPorts.delete(port);
          if (port === masterClientPort) {
              console.log("SharedWorker: Master client disconnected.");
              resetSessionState("Master client disconnected");
          }
          clearInterval(checkPort);
          console.log(`SharedWorker: Client disconnected. Total: ${connectedPorts.size}`);
      }
  }, 30000); // Ping every 30s


  port.onmessage = async (event) => {
    const message = event.data;
    console.log("SharedWorker: Message from a client:", message);

    if (message.type === 'INIT_CONFIG_SW') { // Changed message type
      if (!CONFIG) {
        CONFIG = message.payload.config;
        // Define worker-side function handlers if they fetch data directly
        CONFIG.FUNCTION_HANDLERS_IN_WORKER = {
            'get_weather': async (output, bc, conf) => { /* ... */ return {temp: 25}; },
            'search_web': async (output, bc, conf) => { /* ... */ return {title: "Search Result"};}
        };
        console.log("SharedWorker: CONFIG initialized.");
      }
      // Always send ready/current state after config attempt
      port.postMessage({ type: 'WORKER_CONFIGURED_SENDING_STATE', payload: { status: globalSessionStatus, voice: currentVoiceForSession, masterPortExists: !!masterClientPort } });
      return;
    }

    if (!CONFIG) {
      port.postMessage({ type: 'ERROR', payload: { message: "Worker not configured. Send INIT_CONFIG_SW first." }});
      return;
    }

    switch (message.type) {
      case 'REQUEST_TO_START_SESSION':
        await handleRequestToStartSession(port, message.payload.voice);
        break;
      case 'OFFER_TO_WORKER': // Master client sends its offer
        await handleOfferFromMaster(port, message.payload.sdp);
        break;
      case 'DATA_CHANNEL_OPENED_BY_MASTER': // Master confirms its DC is open
        if (port === masterClientPort) updateGlobalSessionStatus("connected");
        break;
      case 'MESSAGE_FROM_AI_TO_WORKER': // Master forwards AI message
        handleMessageFromAIviaMaster(port, message.payload.aiMessage);
        break;
      case 'CLIENT_MESSAGE_FOR_AI_TO_WORKER': // Any client wants to send to AI
        handleClientMessageForAI(port, message.payload.clientMessage);
        break;
      case 'MASTER_SENT_FUNCTION_RESULT_TO_AI': // Master confirms it sent function result
        // Usually the AI's response after this will trigger next steps.
        // The worker might just log this or update a specific state if needed.
        console.log("SharedWorker: Master confirmed sending function result for call ID:", message.payload.call_id);
        // Potentially, the worker now tells the master to expect/create a new response from AI
        if(masterClientPort) masterClientPort.postMessage({type: 'EXPECT_AI_RESPONSE_AFTER_FUNCTION_CALL'});
        break;
      case 'REQUEST_TO_STOP_SESSION':
        if (port === masterClientPort || !masterClientPort /* Allow any client to stop if master is gone */) {
          await resetSessionState("Stop request from client");
        } else {
            // Inform the non-master client that only master can stop, or that no session is active by master
            port.postMessage({type: 'INFO', payload: {message: "Only the active session owner can stop, or no session is active."}});
        }
        break;
      case 'PONG': // Response to worker's PING
        // console.log("SharedWorker: Received PONG from client, port is alive.");
        break;
      // Handle other client commands if any
    }
  };

  // Send initial state if worker is already configured
  if (CONFIG) {
    port.postMessage({ type: 'WORKER_CONFIGURED_SENDING_STATE', payload: { status: globalSessionStatus, voice: currentVoiceForSession, masterPortExists: !!masterClientPort } });
  } else {
    port.postMessage({type: 'AWAITING_CONFIG_FROM_CLIENT'});
  }
};

console.log("SharedWorker: Script loaded (v2 - client manages RTCPC). Awaiting connections.");