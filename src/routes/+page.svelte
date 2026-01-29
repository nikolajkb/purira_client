<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { convertFileSrc } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { api, type Message as ApiMessage } from '$lib/api';

  interface Message {
    role: string;
    content: string;
    mood?: string;
    image_path?: string;
  }

  // Helper to convert API messages to frontend format
  function flattenMessages(apiMessages: ApiMessage[]): Message[] {
    return apiMessages.flatMap(msg => {
      // For image messages, content_split is [description, user_text]
      // Only show user_text (index 1) for display
      if (msg.image_path && msg.content_split.length >= 2) {
        return [{
          role: msg.role,
          content: msg.content_split[1],  // User text only
          mood: msg.mood,
          image_path: msg.image_path
        }];
      }

      // For regular messages, flatten all content_split items
      return msg.content_split.map(content => ({
        role: msg.role,
        content,
        mood: msg.mood,
        image_path: msg.image_path
      }));
    });
  }

  let message = '';
  let messages: Message[] = [];
  let puriraWriting = false;
  let userWriting = false;
  let currentMood = 'normal'; // Default mood
  let currentExtension = 'png'; // Default extension
  let menuOpen = false;
  let lightMode = false;
  let summarizing = false;
  let summarizeError = '';
  let connectionError = '';
  let attachedImage: string | null = null; // Path to attached image
  let textareaElement: HTMLTextAreaElement;

  // Auto-resize textarea
  function autoResize() {
    if (textareaElement) {
      textareaElement.style.height = '0px';
      const newHeight = Math.max(40, Math.min(200, textareaElement.scrollHeight));
      textareaElement.style.height = newHeight + 'px';
    }
  }

  // Watch for message changes to trigger resize
  $: if (message !== undefined) {
    tick().then(autoResize);
  }

  // Get image source from cache
  async function getImageSrc(filename: string): Promise<string> {
    try {
      const cachePath = await invoke<string>('get_image_cache_path', { filename });
      return convertFileSrc(cachePath);
    } catch (err) {
      console.error('Failed to get image from cache:', err);
      return '';
    }
  }

  // Get preview image for attachment
  async function getAttachmentPreview(): Promise<string> {
    if (!attachedImage) return '';
    try {
      const imageData = JSON.parse(attachedImage);
      return await getImageSrc(imageData.filename);
    } catch {
      return '';
    }
  }

  // Get extension for a mood's avatar file
  // Returns: "mp4" for video, or image extension (png, jpg, jpeg, gif, webp)
  // Falls back to "normal" mood if files don't exist
  async function get_extension(mood: string): Promise<{ mood: string, extension: string }> {
    // First check for video (mp4)
    try {
      const response = await fetch(`/avatar/${mood}.mp4`, { method: 'HEAD' });
      if (response.ok) {
        return { mood, extension: 'mp4' };
      }
    } catch {}

    // Check for image formats
    const imageFormats = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    for (const format of imageFormats) {
      try {
        const response = await fetch(`/avatar/${mood}.${format}`, { method: 'HEAD' });
        if (response.ok) {
          return { mood, extension: format };
        }
      } catch {}
    }

    // Fallback to "normal" mood if current mood files don't exist
    if (mood !== 'normal') {
      return await get_extension('normal');
    }

    // If even "normal" doesn't exist, return default
    return { mood: 'normal', extension: 'png' };
  }

  async function updateMood(mood: string) {
    const result = await get_extension(mood);
    currentMood = result.mood;
    currentExtension = result.extension;
  }

  onMount(() => {
    // Load theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      lightMode = true;
      document.documentElement.classList.add('light-mode');
    }

    (async () => {
      try {
        const apiMessages = await api.getHistory();
        messages = flattenMessages(apiMessages);
        // Set mood from last assistant message with a mood
        const lastMoodMessage = messages.findLast(m => m.mood);
        if (lastMoodMessage?.mood) {
          await updateMood(lastMoodMessage.mood);
        }
        await tick();
        scrollToBottom();
      } catch (err) {
        console.error('Failed to load history:', err);
        connectionError = 'Could not get messages, please ensure that the server is running.';
      }
    })();

    // Set up automatic proactive message checking
    const proactiveCheckInterval = setInterval(async () => {
      try {
        // Don't check if already writing or summarizing
        if (puriraWriting || summarizing) {
          return;
        }

        const shouldSend = await api.shouldSendProactiveMessage();
        if (shouldSend) {
          console.log('15 minutes elapsed since last user message, sending proactive message');
          await sendProactiveMessageAuto();
        }
      } catch (err) {
        console.error('Failed to check for proactive message:', err);
        // Don't show error to user, just log it
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    // Cleanup interval on unmount
    return () => {
      clearInterval(proactiveCheckInterval);
    };
  });

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function toggleLightMode() {
    lightMode = !lightMode;
    if (lightMode) {
      document.documentElement.classList.add('light-mode');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light-mode');
      localStorage.setItem('theme', 'dark');
    }
  }

  async function startSummarization() {
    toggleMenu();
    summarizing = true;
    summarizeError = '';

    try {
      const response = await api.startSummarization();
      console.log('Summarization started:', response.message);

      // Poll for completion
      const pollInterval = setInterval(async () => {
        try {
          const status = await api.getSummarizationStatus();
          if (status.status === 'idle') {
            clearInterval(pollInterval);
            summarizing = false;
            console.log('Summarization completed');
          }
        } catch (err) {
          clearInterval(pollInterval);
          summarizing = false;
          summarizeError = `Failed to check status: ${err}`;
          console.error('Status check error:', err);
        }
      }, 2000); // Poll every 2 seconds

    } catch (err) {
      summarizing = false;
      summarizeError = `Failed to start summarization: ${err}`;
      console.error('Summarization error:', err);
    }
  }

  async function sendProactiveMessage() {
    toggleMenu();

    if (puriraWriting || summarizing) {
      alert('Please wait for the current operation to complete.');
      return;
    }

    puriraWriting = true;

    try {
      // Call the proactive message API
      const apiMessages = await api.sendProactiveMessage();

      // Flatten and display the response messages
      const responseMessages = flattenMessages(apiMessages);
      await displayResponseMessages(responseMessages);
    } catch (err) {
      console.error('Failed to send proactive message:', err);
      alert(`Error: ${err}`);
    } finally {
      puriraWriting = false;
    }
  }

  async function sendProactiveMessageAuto() {
    // Automatic version (no menu toggle, no alerts)
    if (puriraWriting || summarizing) {
      return;
    }

    puriraWriting = true;

    try {
      // Call the proactive message API
      const apiMessages = await api.sendProactiveMessage();

      // Flatten and display the response messages
      const responseMessages = flattenMessages(apiMessages);
      await displayResponseMessages(responseMessages);
    } catch (err) {
      console.error('Failed to send automatic proactive message:', err);
      // Don't alert user for automatic messages
    } finally {
      puriraWriting = false;
    }
  }

  async function triggerWebSearch() {
    toggleMenu();

    if (puriraWriting || summarizing) {
      alert('Please wait for the current operation to complete.');
      return;
    }

    puriraWriting = true;

    try {
      // Call the web search background action API
      // Background action messages are not displayed in the UI
      await api.triggerWebSearch();
      console.log('Web search completed successfully');
    } catch (err) {
      console.error('Failed to trigger web search:', err);
      alert(`Error: ${err}`);
    } finally {
      puriraWriting = false;
    }
  }

  async function triggerReminisce() {
    toggleMenu();

    if (puriraWriting || summarizing) {
      alert('Please wait for the current operation to complete.');
      return;
    }

    puriraWriting = true;

    try {
      // Call the reminisce background action API
      // Background action messages are not displayed in the UI
      await api.triggerReminisce();
      console.log('Reminisce completed successfully');
    } catch (err) {
      console.error('Failed to trigger reminisce:', err);
      const errorMsg = String(err);
      if (errorMsg.includes('Not enough messages')) {
        alert('Not enough messages to reminisce about (need at least 10)');
      } else {
        alert(`Error: ${err}`);
      }
    } finally {
      puriraWriting = false;
    }
  }

  async function attachImage() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        filters: [{
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp']
        }]
      });

      if (filePath) {
        // Read file as base64 using Tauri command
        const base64 = await invoke<string>('read_file_as_base64', { path: filePath });

        // Extract extension from original filename
        const originalFilename = filePath.split(/[\\/]/).pop() || 'image.png';
        const extension = originalFilename.split('.').pop() || 'png';

        // Generate timestamped filename: {timestamp}.{extension}
        const timestamp = Date.now();
        const filename = `${timestamp}.${extension}`;

        // Save to local cache
        await invoke('save_image_to_cache', { filename, base64Data: base64 });

        // Store reference for sending to server
        attachedImage = JSON.stringify({ filename, data: base64 });
      }
    } catch (err) {
      console.error('Failed to pick image:', err);
      alert(`Failed to select image: ${err}`);
    }
  }

  function clearAttachment() {
    attachedImage = null;
  }

  async function send(e?: Event) {
    if (e) e.preventDefault();
    const text = message.trim();
    if (!text || puriraWriting || summarizing) return;

    // Track message count for rollback
    const messagesBeforeSend = messages.length;
    const hadAttachment = attachedImage !== null;
    const attachmentData = attachedImage;

    // Parse attachment data if present
    let imageFilename: string | undefined;
    if (attachedImage) {
      const imageData = JSON.parse(attachedImage);
      imageFilename = imageData.filename;
    }

    // Show user message immediately with cached image reference
    messages.push({
      role: 'user',
      content: text,
      image_path: imageFilename
    });
    messages = messages;
    message = '';
    attachedImage = null; // Clear attachment
    puriraWriting = true;

    await tick();
    scrollToBottom();

    try {
      // Use unified endpoint for all message types
      let apiMessages;
      if (hadAttachment && attachmentData) {
        // Parse image data and send to server
        const imageData = JSON.parse(attachmentData);
        apiMessages = await api.sendUnifiedMessage(text, [imageData]);
      } else {
        // Regular text-only chat
        apiMessages = await api.sendUnifiedMessage(text, []);
      }

      const responseMessages = flattenMessages(apiMessages);
      await displayResponseMessages(responseMessages);
    } catch (err) {
      console.error('Failed to send message:', err);
      // Rollback user message on error
      messages = messages.slice(0, messagesBeforeSend);
      // Restore attachment if it was there
      if (hadAttachment) {
        attachedImage = attachmentData;
      }
      const errorMsg = String(err);
      if (errorMsg.includes('503') || errorMsg.includes('summarization')) {
        alert('Cannot send messages while summarization is in progress. Please wait.');
      } else {
        alert(`Error: ${err}`);
      }
    } finally {
      puriraWriting = false;
    }
  }

  function scrollToBottom() {
    const container = document.getElementById('chat');
    if (container) container.scrollTop = container.scrollHeight;
  }

  async function displayResponseMessages(responseMessages: Message[], delay: number = 1000) {
    for (const msg of responseMessages) {
      messages.push(msg);
      messages = messages;
      if (msg.mood) {
        await updateMood(msg.mood);
      }
      await tick();
      scrollToBottom();
      if (responseMessages.indexOf(msg) < responseMessages.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
</script>

<main class="container">
  <button class="menu-button" on:click={toggleMenu}>☰</button>
  
  {#if menuOpen}
    <div class="menu-overlay" on:click={toggleMenu} on:keydown={(e) => e.key === 'Escape' && toggleMenu()} role="button" tabindex="-1">
      <div class="menu-content" on:click|stopPropagation on:keydown|stopPropagation role="dialog" tabindex="0">
        <button class="menu-item" on:click={() => { toggleLightMode(); toggleMenu(); }}>
          {lightMode ? 'Dark Mode' : 'Light Mode'}
        </button>
        <button class="menu-item" on:click={sendProactiveMessage} disabled={puriraWriting || summarizing}>
          Let Purira Speak
        </button>
        <button class="menu-item" on:click={triggerWebSearch} disabled={puriraWriting || summarizing}>
          Web Search
        </button>
        <button class="menu-item" on:click={triggerReminisce} disabled={puriraWriting || summarizing}>
          Reminisce
        </button>
        <button class="menu-item" on:click={startSummarization} disabled={summarizing}>
          {summarizing ? 'Summarizing...' : 'Summarize History'}
        </button>
      </div>
    </div>
  {/if}

  <div class="chat-wrapper">
    <div class="image-display">
      {#if currentExtension === 'mp4'}
        <video src="/avatar/{currentMood}.mp4" autoplay loop muted playsinline></video>
      {:else}
        <img src="/avatar/{currentMood}.{currentExtension}" alt="Purira - {currentMood}" />
      {/if}
    </div>
    
    <div id="chat" class="chat-window" aria-live="polite">
      {#each messages as msg}
        <div class="message {msg.role === 'user' ? 'right' : 'left'}">
          <div class="bubble">
            {#if msg.image_path}
              {#await getImageSrc(msg.image_path)}
                <div class="loading-image">Loading image...</div>
              {:then src}
                {#if src}
                  <img
                    src={src}
                    alt="user sent this"
                    class="screenshot-image"
                  />
                {/if}
              {/await}
            {/if}
            {#if msg.content && !msg.content.startsWith('[Screenshot')}
              <div class="message-text">{msg.content}</div>
            {:else if msg.content}
              {msg.content}
            {/if}
          </div>
        </div>
      {/each}
      {#if puriraWriting}
        <div class="message left">
          <div class="bubble loading">...</div>
        </div>
      {/if}
      {#if userWriting}
        <div class="message right">
          <div class="bubble loading">...</div>
        </div>
      {/if}
    </div>

    <form class="composer" on:submit|preventDefault={send}>
      {#if attachedImage}
        <div class="attachment-preview">
          {#await getAttachmentPreview()}
            <div class="loading-preview">Loading...</div>
          {:then src}
            {#if src}
              <img src={src} alt="Attachment preview" />
            {/if}
          {/await}
          <button
            type="button"
            class="clear-attachment"
            on:click={clearAttachment}
            title="Remove attachment"
          >×</button>
        </div>
      {/if}
      <button
        type="button"
        class="attach-button"
        on:click={attachImage}
        disabled={puriraWriting || summarizing}
        title="Attach image"
      >+</button>
      <textarea
        spellcheck="false"
        id="greet-input"
        bind:this={textareaElement}
        bind:value={message}
        on:input={autoResize}
        on:keydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        disabled={puriraWriting || summarizing}
        placeholder={summarizing ? 'Summarizing history...' : ''}
        rows="1"
      ></textarea>
    </form>
  </div>

  {#if summarizing}
    <div class="summarizing-indicator">
      Summarizing conversation history...
    </div>
  {/if}

  {#if summarizeError}
    <div class="error-message">
      {summarizeError}
      <button on:click={() => summarizeError = ''}>×</button>
    </div>
  {/if}

  {#if connectionError}
    <div class="connection-error-overlay">
      <div class="connection-error-content">
        <div class="error-text">{connectionError}</div>
        <button class="retry-button" on:click={() => window.location.reload()}>
          Retry Connection
        </button>
      </div>
    </div>
  {/if}
</main>

<style>
.summarizing-indicator {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-secondary);
  color: var(--text-color);
  border: 2px solid var(--border-color);
  border-radius: 4px;
  padding: 1rem 2rem;
  font-family: inherit;
  z-index: 1000;
  box-shadow: var(--menu-shadow);
}

.error-message {
  position: fixed;
  top: 2rem;
  left: 50%;
  transform: translateX(-50%);
  background: #ff3333;
  color: white;
  border: 2px solid #cc0000;
  border-radius: 4px;
  padding: 1rem 2rem;
  font-family: inherit;
  z-index: 1001;
  display: flex;
  gap: 1rem;
  align-items: center;
}

.error-message button {
  background: transparent;
  color: white;
  border: 1px solid white;
  border-radius: 50%;
  width: 1.5rem;
  height: 1.5rem;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0;
}

.error-message button:hover {
  background: rgba(255,255,255,0.2);
}

.connection-error-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  backdrop-filter: blur(4px);
}

.connection-error-content {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 2.5rem;
  max-width: 500px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.error-text {
  color: var(--text-color);
  font-size: 1.2rem;
  line-height: 1.6;
}

.retry-button {
  background: var(--bg-tertiary);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.75rem 2rem;
  font-family: inherit;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.retry-button:hover {
  opacity: 0.85;
  transform: translateY(-2px);
}

:root:not(.light-mode) .retry-button:hover {
  background: #002600;
  box-shadow: 0 0 15px rgba(0,255,0,0.4);
  opacity: 1;
}

.menu-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

:root {
  font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;

  /* Dark mode (default) */
  --text-color: #00ff00;
  --bg-color: #000000;
  --bg-secondary: #0a0a0a;
  --bg-tertiary: #001a00;
  --border-color: #00ff00;
  --border-secondary: #00aa00;
  --shadow-color: rgba(0,255,0,0.2);
  --shadow-hover: rgba(0,255,0,0.4);
  --bubble-shadow: 0 0 10px rgba(0,255,0,0.2);
  --menu-shadow: 0 0 30px rgba(0,255,0,0.3);

  color: var(--text-color);
  background-color: var(--bg-color);

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

:root.light-mode {
  font-family: Inter, Avenir, Helvetica, Arial, sans-serif;

  /* Light mode */
  --text-color: #0f0f0f;
  --bg-color: #f6f6f6;
  --bg-secondary: rgba(255,255,255,0.9);
  --bg-tertiary: #e6e6ea;
  --border-color: rgba(0,0,0,0.1);
  --border-secondary: rgba(0,0,0,0.1);
  --shadow-color: rgba(0,0,0,0.08);
  --shadow-hover: rgba(0,0,0,0.12);
  --bubble-shadow: 0 2px 6px rgba(0,0,0,0.08);
  --menu-shadow: 0 4px 20px rgba(0,0,0,0.15);
  --user-bubble-bg: linear-gradient(135deg,#02491b,rgb(1, 98, 25));
  --user-bubble-text: white;
}

:global(html, body) {
  margin: 0;
  padding: 0;
  overflow: hidden;
  height: 100vh;
  width: 100vw;
}

.container {
  margin: 0;
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.chat-wrapper {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.image-display {
  flex: 0 0 50%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--bg-secondary);
  border-bottom: 2px solid var(--border-color);
  overflow: hidden;
}

.image-display img,
.image-display video {
  max-width: 100%;
  height: 103%; 
  object-fit: cover;
  object-position: bottom;
}

.chat-window {
  flex: 1 1 50%;
  background: var(--bg-color);
  padding: 1rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.message {
  display: flex;
  width: 100%;
}

.message.left {
  justify-content: flex-start;
}
.message.right {
  justify-content: flex-end;
}

.bubble {
  max-width: 72%;
  padding: 0.6rem 0.9rem;
  font-size: 0.98rem;
  line-height: 1.2rem;
  box-shadow: var(--bubble-shadow);
  border: 1px solid;
}

:root:not(.light-mode) .bubble {
  border-radius: 4px;
}

:root.light-mode .bubble {
  border-radius: 16px;
}

.message.left .bubble {
  background: var(--bg-tertiary);
  color: var(--text-color);
  border-color: var(--border-color);
}

:root:not(.light-mode) .message.left .bubble {
  border-bottom-left-radius: 2px;
}

:root.light-mode .message.left .bubble {
  border-bottom-left-radius: 6px;
}

.message.right .bubble {
  background: var(--bg-tertiary);
  color: var(--text-color);
  border-color: var(--border-secondary);
}

:root:not(.light-mode) .message.right .bubble {
  border-bottom-right-radius: 2px;
}

:root.light-mode .message.right .bubble {
  background: var(--user-bubble-bg);
  color: var(--user-bubble-text);
  border-bottom-right-radius: 6px;
}

.bubble.loading {
  opacity: 0.7;
  font-style: italic;
}

.screenshot-image {
  max-width: 100%;
  height: auto;
  display: block;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 2px;
}

.loading-image, .loading-preview {
  color: var(--text-color);
  opacity: 0.7;
  font-style: italic;
  padding: 0.5rem;
}

.composer {
  display: flex;
  gap: 0;
  align-items: stretch;
  background: var(--bg-secondary);
  flex-shrink: 0;
  border-top: 2px solid var(--border-color);
  position: relative;
}

.attachment-preview {
  position: absolute;
  bottom: 100%;
  left: 1rem;
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  padding: 0.5rem;
  max-width: 200px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.attachment-preview img {
  max-width: 150px;
  max-height: 100px;
  border: 1px solid var(--border-color);
  border-radius: 2px;
}

.clear-attachment {
  background: var(--bg-tertiary);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 1.5rem;
  height: 1.5rem;
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}

.clear-attachment:hover {
  opacity: 0.8;
}

.attach-button {
  background: var(--bg-secondary);
  color: var(--text-color);
  border: none;
  border-right: 1px solid var(--border-color);
  padding: 0 0.5em;
  font-size: 1.5rem;
  cursor: pointer;
  flex-shrink: 0;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
}

.attach-button:hover:not(:disabled) {
  opacity: 0.8;
}

.attach-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

textarea {
  padding: 0.5em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-color);
  background-color: transparent;
  border: none;
  outline: none;
  flex: 1 1 auto;
  resize: none;
  overflow-y: auto;
  line-height: 1.5;
  height: 40px;
  min-height: 40px;
  max-height: 200px;
  box-sizing: border-box;
}

textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.menu-button {
  position: fixed;
  top: 1rem;
  right: 1rem;
  background: var(--bg-secondary);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  font-size: 1.2rem;
  font-family: inherit;
  cursor: pointer;
  z-index: 1000;
  box-shadow: var(--bubble-shadow);
}

.menu-button:hover {
  background: var(--bg-tertiary);
  box-shadow: var(--bubble-shadow);
}

:root:not(.light-mode) .menu-button:hover {
  box-shadow: 0 0 15px rgba(0,255,0,0.4);
}

.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999;
}

.menu-content {
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-radius: 4px;
  padding: 2rem;
  min-width: 300px;
  box-shadow: var(--menu-shadow);
}

.menu-item {
  width: 100%;
  background: var(--bg-tertiary);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.75rem 1rem;
  font-family: inherit;
  font-size: 1rem;
  cursor: pointer;
  margin-bottom: 0.5rem;
}

.menu-item:hover {
  opacity: 0.85;
}

:root:not(.light-mode) .menu-item:hover {
  background: #002600;
  box-shadow: 0 0 10px rgba(0,255,0,0.3);
  opacity: 1;
}

:root.light-mode .menu-item {
  background: rgba(255,255,255,0.95);
}

.menu-item:last-child {
  margin-bottom: 0;
}

</style>
