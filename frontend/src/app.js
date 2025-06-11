// app.js (Client-side, manages its own WebRTC objects)

class ErrorHandler { // Assuming a simple client-side error handler
  static handle(error, context, uiShowErrorCallback) {
    console.error(`Client App Error in ${context}:`, error.message, error);
    if (uiShowErrorCallback) uiShowErrorCallback(`Error in ${context}: ${error.message}`);
  }
}

export default class App {
  constructor(config, uiCallbacks) {
    this.config = config;
    this.ui = uiCallbacks;
    this.workerPort = null;
    this.currentDesiredVoice = config.VOICE;

    this.isMasterClient = false;
    this.peerConnection = null;
    this.audioStream = null; // Local audio stream
    this.dataChannel = null; // Local data channel object

    this.ui.updateStatus("Ready to start");
    this.ui.updateButtons(false);
    this.ui.updateVoiceSelector(true);

    this._connectToSharedWorker(); // Connect on instantiation
  }

  async _connectToSharedWorker() {
    if (this.workerPort) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (window.SharedWorker) {
        try {
          const worker = new SharedWorker(new URL('./assistant-shared-worker.js', import.meta.url), {
            name: 'VoiceAssistantOrchestratorWorker'
          });
          this.workerPort = worker.port;
          this.workerPort.onmessage = (event) => this._handleWorkerMessage(event.data);
          this.workerPort.onmessageerror = (error) => {
            ErrorHandler.handle(error, "SharedWorkerPortMessage", this.ui.showError);
            this.ui.updateStatus("Worker Comms Error");
            reject(error);
          };
          this.workerPort.start();
          console.log("App: Port to SharedWorker started. Sending INIT_CONFIG_SW.");
          // Send config and wait for acknowledgment or initial state
          this.workerPort.postMessage({ type: 'INIT_CONFIG_SW', payload: { config: this.config } });
          resolve();
        } catch (error) {
          ErrorHandler.handle(error, "SharedWorkerConnection", this.ui.showError);
          this.ui.updateStatus("Worker Conn. Failed");
          reject(error);
        }
      } else {
        this.ui.showError("SharedWorker API not supported.");
        this.ui.updateStatus("Browser Not Supported");
        reject(new Error("SharedWorker not supported"));
      }
    });
  }

  _handleWorkerMessage(message) {
    console.log("App: Message from SharedWorker:", message);
    switch (message.type) {
      case 'AWAITING_CONFIG_FROM_CLIENT':
        // This client might be the first, ensure config was sent.
        console.log("App: Worker is awaiting config. Config was sent.");
        break;
      case 'WORKER_CONFIGURED_SENDING_STATE':
      case 'SESSION_STATUS_UPDATE':
        this.ui.updateStatus(message.payload.status);
        const isEffectivelyConnected = message.payload.status === 'connected' || message.payload.status === 'answer_sent_to_master' || message.payload.status === 'key_fetched_tell_master_to_offer';
        this.ui.updateButtons(isEffectivelyConnected && this.isMasterClient); // Only master shows "connected" based on its DC
        this.ui.updateVoiceSelector(message.payload.status === 'idle' || message.payload.status === 'stopped' || message.payload.status === 'failed');
        if (message.payload.voice) this.currentDesiredVoice = message.payload.voice; // Sync UI
        if (message.payload.error) this.ui.showError(`Worker: ${message.payload.error}`);
        else if(message.payload.status !== 'failed') this.ui.hideError();

        // If this client was master, but worker reset session (e.g. another client became master)
        if (this.isMasterClient && (message.payload.status === 'stopped' || message.payload.status === 'idle') && message.payload.reason ) {
            console.log("App: Session stopped by worker, cleaning up master client RTC resources.", message.payload.reason);
            this._cleanupLocalWebRTC();
            this.isMasterClient = false;
        }
        break;
      case 'PROCEED_AS_MASTER_CREATE_OFFER':
        this.isMasterClient = true;
        this.ui.updateStatus("Initializing WebRTC as master...");
        this._initLocalWebRTCAndCreateOffer(message.payload.voice);
        break;
      case 'ANSWER_FOR_MASTER_CLIENT':
        if (this.isMasterClient) {
          this._handleAnswerFromWorker(message.payload.sdp);
        }
        break;
      case 'TRANSCRIPT_UPDATE':
        this.ui.updateTranscript(message.payload.text, message.payload.type);
        break;
      case 'HTML_UPDATE':
        this.ui.updateHTML(message.payload.html, message.payload.type);
        break;
      case 'REQUEST_CLIENT_ACTION':
        if (message.payload.action === 'open_whatsapp') this.ui.openWhatsApp(message.payload.data);
        else if (message.payload.action === 'updateMap' && window.updateMap) window.updateMap(message.payload.data.latitude, message.payload.data.longitude, message.payload.data.locationName);
        break;
      case 'MASTER_HANDLE_FUNCTION_CALL': // Worker tells this master client to handle a function call
        if (this.isMasterClient) {
            this._handleFunctionCallLocally(message.payload.functionCall);
        }
        break;
      case 'SEND_FUNCTION_RESULT_TO_AI': // Worker instructs master to send this (if worker handled function)
        if (this.isMasterClient) {
            this._sendFunctionOutputToAI(message.payload.call_id, message.payload.result);
            this._sendResponseCreateToAI(); // And then tell AI to generate next response
        }
        break;
      case 'EXPECT_AI_RESPONSE_AFTER_FUNCTION_CALL':
        if (this.isMasterClient) {
            // Nothing specific to do here other than wait for AI's message on data channel
            console.log("App (Master): Now expecting AI response after function call output.");
        }
        break;
      case 'SEND_THIS_TO_AI_VIA_DC': // Worker relays a message from another client for this master to send
        if (this.isMasterClient && this.dataChannel && this.dataChannel.readyState === 'open') {
            this._sendMessageToAIOverDataChannel(message.payload); // `message.payload` is the original clientMessage for AI
        }
        break;
      case 'SESSION_TERMINATED_BY_WORKER_STOP_RTC':
      case 'YOU_ARE_NO_LONGER_MASTER_STOP_YOUR_RTC':
        console.log("App: Worker indicated session termination or master change. Cleaning up RTC.");
        this._cleanupLocalWebRTC();
        this.isMasterClient = false;
        this.ui.updateButtons(false);
        this.ui.updateStatus(message.type === 'YOU_ARE_NO_LONGER_MASTER_STOP_YOUR_RTC' ? "Another tab took over" : "Session Terminated");
        break;
      case 'WORKER_ERROR':
        ErrorHandler.handle(new Error(message.payload.details || message.payload.message), `FromSW (${message.payload.context})`, this.ui.showError);
        // if critical, update UI to disconnected
        if (message.payload.context && (message.payload.context.includes("SessionInitialization") || message.payload.context.includes("SDPExchange"))) {
            this.ui.updateStatus("Connection Failed (Worker)");
            this.ui.updateButtons(false);
            this.isMasterClient = false; // No longer master if init failed
        }
        break;
      case 'ERROR': // Generic error from worker
         this.ui.showError(`Worker Error: ${message.payload.message}`);
         break;
      case 'INFO':
          this.ui.showError(`Worker Info: ${message.payload.message}`); // Using showError for info for now
          break;
      case 'PING': // Respond to worker's PING
        if (this.workerPort) this.workerPort.postMessage({type: 'PONG'});
        break;
      default:
        console.warn("App: Unhandled message from SharedWorker:", message.type);
    }
  }

  // --- Local WebRTC Management (called when this client is Master) ---
  async _initLocalWebRTCAndCreateOffer(voice) {
    if (this.peerConnection) this._cleanupLocalWebRTC(); // Clean up previous if any

    this.currentDesiredVoice = voice; // Sync with voice session is starting with
    this.ui.updateStatus("Master: Setting up WebRTC...");
    try {
      this.peerConnection = new RTCPeerConnection(this.config.RTC_CONFIG || undefined);
      this.peerConnection.onicecandidate = (event) => {
        // ICE candidates are usually handled by offer/answer exchange with trickle ICE disabled
        // If your backend needs separate ICE candidates, you'd send them to worker here.
        if (event.candidate) console.log("App (Master): Local ICE candidate:", event.candidate);
      };
      this.peerConnection.ontrack = (event) => { // Remote audio from AI
        console.log("App (Master): Remote track received from AI.", event.streams);
        if (event.streams && event.streams[0]) {
          // this.ui.setRemoteAudioStream(event.streams[0]); // Vue component needs this callback

        }
      };
      this.peerConnection.onconnectionstatechange = () => {
          console.log("App (Master) PC State:", this.peerConnection?.connectionState);
          if(this.peerConnection?.connectionState === 'failed' || this.peerConnection?.connectionState === 'closed' || this.peerConnection?.connectionState === 'disconnected'){
              this.ui.showError(`Master PC state: ${this.peerConnection.connectionState}`);
              // Inform worker about this failure if it wasn't initiated by worker
              if(this.workerPort) this.workerPort.postMessage({type: 'MASTER_RTC_CONNECTION_FAILED_OR_CLOSED'});
              this._cleanupLocalWebRTC();
              this.isMasterClient = false; // No longer master
              this.ui.updateButtons(false);
          }
      }


      // Get local audio
      // this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // this.audioStream.getTracks().forEach(track => this.peerConnection.addTrack(track, this.audioStream));
      // this.ui.setLocalAudioStream(this.audioStream); // For mute toggle or local feedback if needed
      await this.setupAudio();

      // Setup DataChannel
      this.dataChannel = this.peerConnection.createDataChannel("oai-events-client-master");
      this.dataChannel.onopen = () => {
        console.log("App (Master): Local DataChannel OPEN.");
        if (this.workerPort) this.workerPort.postMessage({ type: 'DATA_CHANNEL_OPENED_BY_MASTER' });
        this.ui.updateStatus("Connected (Data Channel Open)");
        this.ui.updateButtons(true);
        // Now that DC is open, master can send initial messages (though worker coordinated this)
        // The worker's "onDataChannelOpenInWorker" is conceptual; actual messages sent after setup.
        // Master could re-send session update and initial message if worker doesn't do it based on state.
        // For now, assume worker handles initial AI messages upon 'DATA_CHANNEL_OPENED_BY_MASTER'
      };
      this.dataChannel.onmessage = (event) => { // Messages from AI
        if (this.workerPort) {
          this.workerPort.postMessage({ type: 'MESSAGE_FROM_AI_TO_WORKER', payload: { aiMessage: event.data } });
        }
      };
      this.dataChannel.onclose = () => {
        console.log("App (Master): Local DataChannel CLOSED.");
        this.ui.showError("Data Channel Closed.");
         if (this.workerPort) this.workerPort.postMessage({ type: 'DATA_CHANNEL_CLOSED_BY_MASTER' });
        this.ui.updateButtons(false);
      };
      this.dataChannel.onerror = (error) => {
        ErrorHandler.handle(error, "MasterDataChannel", this.ui.showError);
        if (this.workerPort) this.workerPort.postMessage({ type: 'DATA_CHANNEL_ERROR_BY_MASTER', payload: {error: error.toString()}});
      };

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      if (this.workerPort) {
        this.workerPort.postMessage({ type: 'OFFER_TO_WORKER', payload: { sdp: offer.sdp } });
      }
    } catch (error) {
      ErrorHandler.handle(error, "MasterLocalWebRTCInit", this.ui.showError);
      this.ui.updateStatus("WebRTC Setup Failed");
      this._cleanupLocalWebRTC();
      this.isMasterClient = false;
       if (this.workerPort) this.workerPort.postMessage({ type: 'MASTER_RTC_SETUP_FAILED' });
    }
  }

  async setupAudio() {
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    this.peerConnection.ontrack = (e) => (audioEl.srcObject = e.streams[0]);

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      this.audioStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.audioStream);
      });
    } catch (error) {
      ErrorHandler.handle(error, "getUserMedia");
      this.app.ui.showError("Failed to access microphone.");
    }
  }

  async _handleAnswerFromWorker(answerSdp) {
    if (!this.peerConnection) {
      ErrorHandler.handle(new Error("No PeerConnection for answer"), "HandleAnswer", this.ui.showError);
      return;
    }
    this.ui.updateStatus("Master: Received answer, connecting...");
    try {
      await this.peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      // Connection will now establish, DataChannel onopen will fire.
    } catch (error) {
      ErrorHandler.handle(error, "MasterSetRemoteDescription", this.ui.showError);
      this.ui.updateStatus("Connection Failed (SDP Answer)");
       if (this.workerPort) this.workerPort.postMessage({ type: 'MASTER_RTC_ANSWER_REJECTED' });
    }
  }

  _sendMessageToAIOverDataChannel(messagePayload) {
      if (this.isMasterClient && this.dataChannel && this.dataChannel.readyState === 'open') {
          try {
            this.dataChannel.send(JSON.stringify(messagePayload)); // Assuming messagePayload is the object AI expects
            console.log("App (Master): Sent to AI via DC:", messagePayload);
          } catch (error) {
            ErrorHandler.handle(error, "MasterSendDataChannel", this.ui.showError);
          }
      } else {
          this.ui.showError("Cannot send: Not master or Data Channel not open.");
      }
  }

  // Called by worker if a function call is for this master client to handle
  async _handleFunctionCallLocally(functionCall) {
    if (!this.isMasterClient) return;
    console.log("App (Master): Handling function call locally:", functionCall);
    let result;
    try {
        if (functionCall.name === 'open_whatsapp') { // This one is UI specific
            this.ui.openWhatsApp(functionCall); // Assumes output of functionCall is needed by UI method
            result = { status: "WhatsApp action taken by UI." };
        } else if (this.config.CLIENT_FUNCTION_HANDLERS && this.config.CLIENT_FUNCTION_HANDLERS[functionCall.name]) {
            // For functions that client master *must* run (e.g. requires client context not available to worker)
            result = await this.config.CLIENT_FUNCTION_HANDLERS[functionCall.name](functionCall, this.ui, this.config);
        } else {
            console.warn("App (Master): Unhandled local function call:", functionCall.name);
            result = { error: "Function not implemented client-side" };
        }
    } catch (error) {
        ErrorHandler.handle(error, `MasterLocalFunction-${functionCall.name}`, this.ui.showError);
        result = { error: error.message };
    }
    this._sendFunctionOutputToAI(functionCall.call_id, result);
    this._sendResponseCreateToAI(); // Tell AI to process the function output
  }

  _sendFunctionOutputToAI(callId, data) {
      const message = {
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(data),
          },
        };
      this._sendMessageToAIOverDataChannel(message);
      // Also inform worker that this was done
      if (this.workerPort) {
        this.workerPort.postMessage({type: 'MASTER_SENT_FUNCTION_RESULT_TO_AI', payload: {call_id: callId}});
      }
  }

   _sendResponseCreateToAI() {
       this._sendMessageToAIOverDataChannel({ type: "response.create" });
   }


  _cleanupLocalWebRTC() {
    console.log("App: Cleaning up local WebRTC resources.");
    if (this.dataChannel) {
      if (this.dataChannel.readyState === 'open') this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
      // this.ui.setLocalAudioStream(null);
    }
    if (this.peerConnection) {
      if (this.peerConnection.connectionState !== 'closed') this.peerConnection.close();
      this.peerConnection = null;
      // this.ui.setRemoteAudioStream(null);
    }
    // this.isMasterClient = false; // Don't reset isMasterClient here, worker controls that status
  }

  // --- Public methods for Vue component ---
  async init() { // User clicks "Start"
    if (!this.workerPort) {
      try {
        await this._connectToSharedWorker();
      } catch (error) {
        this.ui.updateStatus("Worker Connection Failed on Init");
        return; // Don't proceed if worker connection failed
      }
    }
    this.ui.updateStatus("Requesting session...");
    this.ui.hideError();
    this.isMasterClient = false; // Assume not master until worker says so
    this.workerPort.postMessage({ type: 'REQUEST_TO_START_SESSION', payload: { voice: this.currentDesiredVoice } });
  }

  stop() { // User clicks "Stop"
    if (this.workerPort) {
      this.workerPort.postMessage({ type: 'REQUEST_TO_STOP_SESSION' });
    }
    // Local RTC cleanup will be triggered by worker message ('SESSION_TERMINATED_BY_WORKER_STOP_RTC' or if this client was master)
    // or if this client itself was master and initiated the stop.
    // For now, worker message handles cleanup of master. UI reflects stop locally.
    this._cleanupLocalWebRTC(); // Proactive cleanup if this client thinks it's stopping
    this.isMasterClient = false;
    this.ui.updateButtons(false);
    this.ui.updateVoiceSelector(true);
    this.ui.updateStatus("Ready to start");
  }

  disconnectPort() { // On component unmount
    if (this.workerPort) {
      // Inform worker this tab is going away. Worker might re-assign master if this was it.
      this.workerPort.postMessage({type: 'CLIENT_PORT_CLOSING', payload: {wasMaster: this.isMasterClient}});
      this.workerPort.close(); // Close this tab's specific port
      this.workerPort = null;
    }
    this._cleanupLocalWebRTC(); // Clean up any local RTC resources
    this.isMasterClient = false;
  }

  handleVoiceChange(newVoice) {
    this.currentDesiredVoice = newVoice;
    if (this.workerPort) {
      this.ui.updateStatus(`Changing voice to ${newVoice}...`);
      // If a session is active, stopping and starting with new voice is managed by worker's logic
      // `REQUEST_TO_START_SESSION` will trigger reset if voice differs or if this client becomes master
      this.workerPort.postMessage({ type: 'REQUEST_TO_START_SESSION', payload: { voice: this.currentDesiredVoice } });
    }
  }

  // If this client (not master) wants to send a text message to AI (hypothetical UI feature)
  sendTextMessageToAI(text) {
      if (this.workerPort) {
          const messageForAI = {
              type: "conversation.item.create",
              item: {
                  type: "message",
                  role: "user",
                  content: [{ type: "input_text", text: text }]
              }
          };
          this.workerPort.postMessage({ type: 'CLIENT_MESSAGE_FOR_AI_TO_WORKER', payload: { clientMessage: messageForAI } });
      } else {
          this.ui.showError("Not connected to worker to send message.");
      }
  }
}