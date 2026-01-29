export interface Message {
  role: string;
  content_raw: string;
  content_split: string[];
  mood?: string;
  time: number;
  image_path?: string;
  message_type: string;
}

export interface ChatResponse {
  messages: Message[];
}

export interface HistoryResponse {
  messages: Message[];
}

export interface SummarizeResponse {
  status: string;
  message: string;
}

export interface ShouldSendProactiveResponse {
  should_send: boolean;
}

interface Config {
  serverUrl: string;
  apiKey: string;
}

class ApiClient {
  private serverUrl: string;
  private apiKey: string;
  private configLoaded: Promise<void>;

  constructor() {
    this.serverUrl = 'http://localhost:3000'; // Default
    this.apiKey = 'dev-key'; // Default
    this.configLoaded = this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch('/config.json');
      if (response.ok) {
        const config: Config = await response.json();
        this.serverUrl = config.serverUrl;
        this.apiKey = config.apiKey;
      }
    } catch (err) {
      console.warn('Failed to load config.json, using defaults:', err);
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.configLoaded;
    
    const url = `${this.serverUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }

    return response.json();
  }

  async getHistory(): Promise<Message[]> {
    await this.configLoaded;
    const data = await this.request<HistoryResponse>('/api/history');
    return data.messages;
  }

  async startSummarization(): Promise<SummarizeResponse> {
    await this.configLoaded;

    return this.request<SummarizeResponse>('/api/summarize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
  }

  async getSummarizationStatus(): Promise<SummarizeResponse> {
    await this.configLoaded;
    return this.request<SummarizeResponse>('/api/summarize/status');
  }

  /**
   * Check if a proactive message should be sent
   * Returns true if 15 minutes have passed since last user message
   */
  async shouldSendProactiveMessage(): Promise<boolean> {
    await this.configLoaded;

    const data = await this.request<ShouldSendProactiveResponse>('/api/proactive-message/should-send');
    return data.should_send;
  }

  /**
   * Send a proactive message from the assistant
   * The assistant will initiate conversation without user input
   */
  async sendProactiveMessage(): Promise<Message[]> {
    await this.configLoaded;

    const data = await this.request<ChatResponse>('/api/proactive-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    return data.messages;
  }

  /**
   * Unified message endpoint supporting all message types
   * Message type is automatically determined based on presence of images
   * @param text User's text input
   * @param images Optional image data objects
   */
  async sendUnifiedMessage(
    text: string,
    images: Array<{filename: string, data: string}> = []
  ): Promise<Message[]> {
    await this.configLoaded;

    const data = await this.request<ChatResponse>('/api/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        images,
      }),
    });
    return data.messages;
  }

  /**
   * Trigger autonomous web search background action
   * The assistant chooses a creative topic to research
   */
  async triggerWebSearch(): Promise<Message[]> {
    await this.configLoaded;

    const data = await this.request<ChatResponse>('/api/background-action/web-search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    return data.messages;
  }

  /**
   * Trigger reminisce background action
   * Selects 10 random sequential messages and generates reflections
   */
  async triggerReminisce(): Promise<Message[]> {
    await this.configLoaded;

    const data = await this.request<ChatResponse>('/api/background-action/reminisce', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    return data.messages;
  }
}

export const api = new ApiClient();
