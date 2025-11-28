import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ShareablePrompt {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly preview?: string;
  readonly customUrl?: string;
}

@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './share-modal.component.html',
  styleUrl: './share-modal.component.css'
})
export class ShareModalComponent {
  readonly isOpen = input.required<boolean>();
  readonly prompt = input<ShareablePrompt | null>(null);
  
  // Output events
  readonly close = output<void>();
  readonly copyOneClickLink = output<'gpt' | 'grok' | 'claude'>();
  readonly openChatbot = output<'ChatGPT' | 'Gemini' | 'Claude' | 'Grok' | 'RocketGoals'>();
  readonly copyPromptUrl = output<void>();
  readonly copyPrompt = output<void>();

  onClose(): void {
    this.close.emit();
  }

  onCopyOneClickLink(target: 'gpt' | 'grok' | 'claude'): void {
    this.copyOneClickLink.emit(target);
  }

  onOpenChatbot(chatbotName: 'ChatGPT' | 'Gemini' | 'Claude' | 'Grok' | 'RocketGoals'): void {
    this.openChatbot.emit(chatbotName);
  }

  onCopyPromptUrl(): void {
    this.copyPromptUrl.emit();
  }

  onCopyPrompt(): void {
    this.copyPrompt.emit();
  }

  stopPropagation(event: Event): void {
    event.stopPropagation();
  }
}
