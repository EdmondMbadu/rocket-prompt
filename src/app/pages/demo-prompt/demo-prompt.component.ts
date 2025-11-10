import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-demo-prompt',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './demo-prompt.component.html',
  styleUrl: './demo-prompt.component.css'
})
export class DemoPromptComponent {
  readonly copied = signal(false);
  private copyTimer?: ReturnType<typeof setTimeout>;

  // Demo prompt content - explains RocketPrompts and how to use AI prompts better
  readonly demoPrompt = {
    title: 'Master Your AI Workflow with RocketPrompts',
    content: `You are an expert AI workflow consultant helping users maximize their productivity with AI tools like ChatGPT, Gemini, and Claude.

Your goal is to help users understand how to:
1. Create effective, reusable prompts that work across different AI platforms
2. Build prompt libraries that save time and improve consistency
3. Share prompts with teams to maintain quality standards
4. Launch prompts instantly with one click instead of copying and pasting

When helping users, provide:
- Clear, actionable advice on prompt engineering
- Examples of well-structured prompts
- Tips for making prompts portable across AI platforms
- Best practices for organizing and sharing prompts

Remember: Great prompts are specific, clear, and reusable. They save time and ensure consistent results across your team.`,
    tag: 'onboarding'
  };

  constructor(private router: Router) {}

  createChatGPTUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    const timestamp = Date.now();
    return `https://chat.openai.com/?q=${encodedPrompt}&t=${timestamp}`;
  }

  createGeminiUrl(prompt: string): string {
    return 'https://gemini.google.com/app';
  }

  createClaudeUrl(prompt: string): string {
    const encodedPrompt = encodeURIComponent(prompt);
    return `https://claude.ai/?prompt=${encodedPrompt}`;
  }

  async openChatbot(url: string, chatbotName: string, promptText?: string) {
    const text = promptText ?? this.demoPrompt.content;

    if (chatbotName === 'ChatGPT') {
      window.open(url, '_blank');
      return;
    }

    // Gemini and Claude: copy to clipboard first
    try {
      if (text) {
        await navigator.clipboard.writeText(text);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    } catch (e) {
      if (text) {
        this.fallbackCopyTextToClipboard(text);
        this.showCopyMessage(`${chatbotName} prompt copied!`);
      }
    }

    window.open(url, '_blank');
  }

  async copyPrompt() {
    const text = this.demoPrompt.content;

    try {
      await navigator.clipboard.writeText(text);
      this.showCopyMessage('Prompt copied!');
      this.markCopied();
    } catch (e) {
      this.fallbackCopyTextToClipboard(text);
      this.showCopyMessage('Prompt copied!');
      this.markCopied();
    }
  }

  private markCopied() {
    try {
      this.copied.set(true);
      if (this.copyTimer) {
        clearTimeout(this.copyTimer);
      }

      const DURATION = 2500;
      this.copyTimer = setTimeout(() => {
        this.copied.set(false);
        this.copyTimer = undefined;
      }, DURATION);
    } catch (e) {
      // ignore
    }
  }

  private showCopyMessage(messageText: string) {
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all';
    message.textContent = messageText;

    document.body.appendChild(message);

    setTimeout(() => {
      message.remove();
    }, 3000);
  }

  private fallbackCopyTextToClipboard(text: string) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }

  navigateToSignUp() {
    this.router.navigate(['/auth'], { queryParams: { mode: 'signup' } });
  }

  navigateToHome() {
    this.router.navigate(['/']);
  }
}

