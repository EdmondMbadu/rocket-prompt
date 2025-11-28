import { Component, inject, signal, ElementRef, ViewChild, AfterViewChecked, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RocketGoalsAIService, ChatMessage } from '../../services/rocket-goals-ai.service';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { AuthService } from '../../services/auth.service';
import type { UserProfile } from '../../models/user-profile.model';
import { ActivatedRoute } from '@angular/router';
import { RocketGoalsLaunchService } from '../../services/rocket-goals-launch.service';

@Component({
  selector: 'app-rocket-goals-ai-page',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './rocket-goals-ai-page.component.html',
  styleUrl: './rocket-goals-ai-page.component.css'
})
export class RocketGoalsAIPageComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('messageInput') private messageInput!: ElementRef<HTMLTextAreaElement>;

  private readonly aiService = inject(RocketGoalsAIService);
  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly rocketGoalsLaunchService = inject(RocketGoalsLaunchService);
  
  readonly inputMessage = signal('');
  readonly messages = this.aiService.messages;
  readonly isLoading = this.aiService.isLoading;
  readonly error = this.aiService.error;
  readonly copiedMessageId = signal<number | null>(null);
  readonly profile = signal<UserProfile | null>(null);
  readonly profileLoaded = signal(false);
  
  private shouldScrollToBottom = false;
  private autoLaunchHandled = false;

  constructor() {
    this.authService.currentUser$
      .pipe(
        switchMap(user => {
          if (!user) {
            return of<UserProfile | null>(null);
          }
          return this.authService.userProfile$(user.uid);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(profile => {
        this.profile.set(profile ?? null);
        this.profileLoaded.set(true);
      });

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const token = params.get('autoLaunch');
        const inlinePrompt = params.get('prompt');

        if (token && !this.autoLaunchHandled) {
          const payload = this.rocketGoalsLaunchService.consumePrompt(token);
          if (payload) {
            this.triggerAutoLaunch(payload);
            return;
          }
        }

        if (inlinePrompt && !this.autoLaunchHandled) {
          this.triggerAutoLaunch(inlinePrompt);
        }
      });
  }

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
      // Headings (###)
      .replace(/^### (.+)$/gm, '<h3 class="ai-heading">$1</h3>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // Line breaks
      .replace(/\n/g, '<br>');
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

  async copyConversation(): Promise<void> {
    const messages = this.messages();
    if (messages.length === 0) return;

    try {
      // Format conversation as a readable text
      const conversationText = messages.map(msg => {
        const role = msg.role === 'user' ? 'You' : 'RocketGoals AI';
        const content = msg.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        return `${role}: ${content}`;
      }).join('\n\n');

      await navigator.clipboard.writeText(conversationText);
      
      // Show feedback
      this.copiedMessageId.set(-1); // Use -1 as special ID for conversation copy
      
      // Reset feedback after 2 seconds
      setTimeout(() => {
        this.copiedMessageId.set(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy conversation:', error);
      // Fallback for older browsers
      const conversationText = messages.map(msg => {
        const role = msg.role === 'user' ? 'You' : 'RocketGoals AI';
        const content = msg.content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
        return `${role}: ${content}`;
      }).join('\n\n');
      
      const textArea = document.createElement('textarea');
      textArea.value = conversationText;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        this.copiedMessageId.set(-1);
        setTimeout(() => {
          this.copiedMessageId.set(null);
        }, 2000);
      } catch (err) {
        console.error('Fallback copy failed:', err);
      }
      document.body.removeChild(textArea);
    }
  }

  isConversationCopied(): boolean {
    return this.copiedMessageId() === -1;
  }

  isCopied(message: ChatMessage): boolean {
    return this.copiedMessageId() === message.timestamp.getTime();
  }

  trackByTimestamp(_index: number, message: ChatMessage): number {
    return message.timestamp.getTime();
  }

  private triggerAutoLaunch(promptText: string): void {
    if (this.autoLaunchHandled || !promptText?.trim()) {
      return;
    }

    this.autoLaunchHandled = true;
    this.inputMessage.set(promptText);
    this.shouldScrollToBottom = true;
    void this.sendMessage();
  }

  private scrollToBottom(): void {
    if (this.messagesContainer?.nativeElement) {
      const el = this.messagesContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }
}
