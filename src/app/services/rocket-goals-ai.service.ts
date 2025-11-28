import { Injectable, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import type { Functions } from 'firebase/functions';
import { environment } from '../../../environments/environments';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

interface AIRequest {
  message: string;
  conversationHistory?: { role: 'user' | 'model'; content: string }[];
}

interface AIResponse {
  response: string;
  model: string;
}

interface GenerateImageRequest {
  prompt: string;
}

interface GenerateImageResponse {
  imageUrl: string;
  prompt: string;
}

@Injectable({
  providedIn: 'root'
})
export class RocketGoalsAIService {
  private readonly app: FirebaseApp = this.ensureApp();
  private functions: Functions | null = null;
  private functionsModule?: typeof import('firebase/functions');

  readonly messages = signal<ChatMessage[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly isOpen = signal(false);

  togglePanel(): void {
    this.isOpen.update(v => !v);
  }

  openPanel(): void {
    this.isOpen.set(true);
  }

  closePanel(): void {
    this.isOpen.set(false);
  }

  async sendMessage(userMessage: string): Promise<string> {
    if (!userMessage.trim()) {
      throw new Error('Message cannot be empty');
    }

    this.isLoading.set(true);
    this.error.set(null);

    // Add user message to conversation
    const userChatMessage: ChatMessage = {
      role: 'user',
      content: userMessage.trim(),
      timestamp: new Date()
    };
    this.messages.update(msgs => [...msgs, userChatMessage]);

    try {
      // Prepare conversation history for context (last 10 messages for efficiency)
      const conversationHistory = this.messages()
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }));

      // Get Firebase Functions context
      const { functions, functionsModule } = await this.getFunctionsContext();
      
      // Call the Cloud Function
      const callable = functionsModule.httpsCallable<AIRequest, AIResponse>(
        functions,
        'rocketGoalsAI'
      );

      const result = await callable({
        message: userMessage.trim(),
        conversationHistory: conversationHistory.slice(0, -1) // Exclude the current message we just added
      });

      // Add AI response to conversation
      const aiChatMessage: ChatMessage = {
        role: 'model',
        content: result.data.response,
        timestamp: new Date()
      };
      this.messages.update(msgs => [...msgs, aiChatMessage]);

      return result.data.response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get AI response';
      this.error.set(errorMessage);
      
      // Remove the user message if we failed
      this.messages.update(msgs => msgs.slice(0, -1));
      
      throw new Error(errorMessage);
    } finally {
      this.isLoading.set(false);
    }
  }

  clearConversation(): void {
    this.messages.set([]);
    this.error.set(null);
  }

  async generateImage(prompt: string): Promise<string> {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      throw new Error('Prompt cannot be empty');
    }

    try {
      const { functions, functionsModule } = await this.getFunctionsContext();
      const callable = functionsModule.httpsCallable<GenerateImageRequest, GenerateImageResponse>(
        functions,
        'generateRocketGoalsImage'
      );

      const result = await callable({ prompt: cleanPrompt });
      return result.data.imageUrl;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate image';
      throw new Error(errorMessage);
    }
  }

  private async getFunctionsContext() {
    const functionsModule = await this.importFunctionsModule();

    if (!this.functions) {
      this.functions = functionsModule.getFunctions(this.app, 'us-central1');
    }

    return {
      functions: this.functions,
      functionsModule
    };
  }

  private async importFunctionsModule() {
    if (!this.functionsModule) {
      this.functionsModule = await import('firebase/functions');
    }

    return this.functionsModule;
  }

  private ensureApp(): FirebaseApp {
    if (getApps().length) {
      return getApp();
    }

    return initializeApp(environment.firebase);
  }
}
