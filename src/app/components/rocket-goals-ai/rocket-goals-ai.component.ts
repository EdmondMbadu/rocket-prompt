import { Component, inject, signal, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RocketGoalsAIService, ChatMessage } from '../../services/rocket-goals-ai.service';

@Component({
  selector: 'app-rocket-goals-ai',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rocket-goals-ai.component.html',
  styleUrl: './rocket-goals-ai.component.css'
})
export class RocketGoalsAIComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('messageInput') private messageInput!: ElementRef<HTMLTextAreaElement>;

  private readonly aiService = inject(RocketGoalsAIService);
  
  readonly isOpen = this.aiService.isOpen;
  readonly inputMessage = signal('');
  readonly messages = this.aiService.messages;
  readonly isLoading = this.aiService.isLoading;
  readonly error = this.aiService.error;
  readonly copiedMessageId = signal<number | null>(null);
  
  private shouldScrollToBottom = false;

  ngAfterViewChecked(): void {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  toggle(): void {
    this.aiService.togglePanel();
    if (this.isOpen()) {
      setTimeout(() => this.messageInput?.nativeElement?.focus(), 100);
    }
  }

  close(): void {
    this.aiService.closePanel();
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

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  clearChat(): void {
    this.aiService.clearConversation();
  }

  sendQuickPrompt(prompt: string): void {
    this.inputMessage.set(prompt);
    this.sendMessage();
  }

  formatMessage(content: string): string {
    // Basic markdown-like formatting
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">$1</code>')
      .replace(/\n/g, '<br>');
  }

  trackByTimestamp(_index: number, message: ChatMessage): number {
    return message.timestamp.getTime();
  }

  async copyMessage(message: ChatMessage): Promise<void> {
    try {
      // Get plain text content (strip HTML tags for copying)
      const textContent = message.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      
      await navigator.clipboard.writeText(textContent);
      
      // Show feedback
      const messageId = message.timestamp.getTime();
      this.copiedMessageId.set(messageId);
      
      // Reset feedback after 2 seconds
      setTimeout(() => {
        this.copiedMessageId.set(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = message.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        const messageId = message.timestamp.getTime();
        this.copiedMessageId.set(messageId);
        setTimeout(() => {
          this.copiedMessageId.set(null);
        }, 2000);
      } catch (err) {
        console.error('Fallback copy failed:', err);
      }
      document.body.removeChild(textArea);
    }
  }

  isCopied(message: ChatMessage): boolean {
    return this.copiedMessageId() === message.timestamp.getTime();
  }

  private scrollToBottom(): void {
    if (this.messagesContainer?.nativeElement) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}

