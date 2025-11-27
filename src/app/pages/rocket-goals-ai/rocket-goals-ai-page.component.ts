import { Component, inject, signal, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RocketGoalsAIService, ChatMessage } from '../../services/rocket-goals-ai.service';

@Component({
  selector: 'app-rocket-goals-ai-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rocket-goals-ai-page.component.html',
  styleUrl: './rocket-goals-ai-page.component.css'
})
export class RocketGoalsAIPageComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('messageInput') private messageInput!: ElementRef<HTMLTextAreaElement>;

  private readonly aiService = inject(RocketGoalsAIService);
  
  readonly inputMessage = signal('');
  readonly messages = this.aiService.messages;
  readonly isLoading = this.aiService.isLoading;
  readonly error = this.aiService.error;
  
  private shouldScrollToBottom = false;

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  async sendMessage(): Promise<void> {
    const message = this.inputMessage().trim();
    if (!message || this.isLoading()) return;

    this.inputMessage.set('');
    this.shouldScrollToBottom = true;

    try {
      await this.aiService.sendMessage(message);
      this.shouldScrollToBottom = true;
    } catch {
      // Error is already handled in service
    }
  }

  sendQuickPrompt(prompt: string): void {
    this.inputMessage.set(prompt);
    this.sendMessage();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  clearChat(): void {
    this.aiService.clearConversation();
  }

  formatMessage(content: string): string {
    // Enhanced markdown-like formatting
    return content
      // Code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  trackByTimestamp(_index: number, message: ChatMessage): number {
    return message.timestamp.getTime();
  }

  private scrollToBottom(): void {
    if (this.messagesContainer?.nativeElement) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}

