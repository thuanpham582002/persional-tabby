import { Component, Input, ElementRef, ViewChild, AfterViewInit, OnChanges, SimpleChanges, AfterViewChecked, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { HotkeysService } from 'tabby-core'

/** @hidden */
@Component({
    selector: 'buffer-text-overlay',
    template: `
        <div class="modal-header">
            <h5 class="modal-title">Buffer Text</h5>
            <button type="button" class="btn-close" (click)="close()"></button>
        </div>
        <div class="modal-body">
            <textarea #textArea class="form-control" autofocus [(ngModel)]="displayText" (focus)="pauseHotkeys()"></textarea>
        </div>
        <div class="modal-footer">
            <div class="form-check me-auto">
                <input class="form-check-input" type="checkbox" id="stripAnsi" [(ngModel)]="stripAnsiEnabled" (change)="onStripAnsiToggle()">
                <label class="form-check-label" for="stripAnsi">
                    Strip ANSI codes
                </label>
            </div>
            <button type="button" class="btn btn-primary" (click)="copyText()">Copy to Clipboard</button>
            <button type="button" class="btn btn-secondary" (click)="close()">Close</button>
        </div>
    `,
    styles: [`
        textarea {
            width: 100%;
            height: 300px;
            font-family: monospace;
            white-space: pre;
            overflow-wrap: normal;
            overflow-x: scroll;
        }
        .form-check {
            margin-top: 8px;
        }
    `],
})
export class BufferTextOverlayComponent implements AfterViewInit, OnChanges, AfterViewChecked {
    @Input() text = ''
    plainText = ''
    displayText = ''
    stripAnsiEnabled = true
    @ViewChild('textArea') textAreaRef: ElementRef<HTMLTextAreaElement>
    private scrollAttempts = 0
    private maxScrollAttempts = 5
    private needsScrollToBottom = true
    private hotkeysPaused = false

    constructor(
        private activeModal: NgbActiveModal,
        private hotkeysService: HotkeysService,
    ) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.text) {
            // Save any existing user edits before updating
            const userText = this.textAreaRef?.nativeElement ? this.preserveUserEdits() : null
            
            this.updateDisplayText()
            
            // If we had user edits and they weren't caused by strip toggle, restore them
            if (userText && !changes.stripAnsiEnabled) {
                setTimeout(() => {
                    this.displayText = userText
                }, 0)
            }
            
            this.needsScrollToBottom = true
        }
    }

    ngAfterViewInit(): void {
        setTimeout(() => {
            this.updateDisplayText()
            this.scrollToBottom()
            this.pauseHotkeys()
        }, 100)
    }

    ngAfterViewChecked(): void {
        if (this.needsScrollToBottom && this.scrollAttempts < this.maxScrollAttempts) {
            this.scrollAttempts++;
            setTimeout(() => {
                this.scrollToBottom();
                if (this.scrollAttempts >= this.maxScrollAttempts) {
                    this.needsScrollToBottom = false;
                }
            }, 200);
        }
    }

    /**
     * Pause hotkeys when the overlay is focused
     */
    pauseHotkeys(): void {
        if (!this.hotkeysPaused) {
            this.hotkeysService.disable()
            this.hotkeysPaused = true
        }
    }

    /**
     * Restore hotkeys when the overlay is closed
     */
    resumeHotkeys(): void {
        if (this.hotkeysPaused) {
            this.hotkeysService.enable()
            this.hotkeysPaused = false
        }
    }

    /**
     * Handle escape key to close overlay
     */
    @HostListener('document:keydown.escape')
    onEscapePressed(): void {
        this.close()
    }

    /**
     * Scrolls the textarea to the bottom and places cursor at the end
     */
    scrollToBottom(): void {
        if (this.textAreaRef?.nativeElement) {
            const textarea = this.textAreaRef.nativeElement

            // Use multiple scroll methods for better compatibility
            // 1. Standard method
            textarea.scrollTop = textarea.scrollHeight
            
            // 2. Force the browser to recalculate layout
            textarea.style.height = (textarea.scrollHeight + 1) + 'px'
            textarea.style.height = '300px'
            
            // 3. Scroll with a slight delay to ensure content is rendered
            setTimeout(() => {
                textarea.scrollTop = textarea.scrollHeight
                
                // Finally set focus and cursor position
                textarea.focus()
                textarea.setSelectionRange(textarea.value.length, textarea.value.length)
            }, 50)
        }
    }

    updateDisplayText(): void {
        if (this.stripAnsiEnabled) {
            this.plainText = this.stripANSI(this.text)
            // If stripping made text empty, use original text as fallback
            this.displayText = this.plainText.trim() ? this.plainText : this.text
        } else {
            this.displayText = this.text
        }
    }

    // Save any user edits before updating the display text
    preserveUserEdits(): string {
        // Store the current edited text if it exists
        return this.textAreaRef?.nativeElement ? this.textAreaRef.nativeElement.value : this.displayText
    }

    /**
     * Strips ANSI escape sequences from text
     */
    stripANSI(text: string): string {
        if (!text) return ''
        
        // A simpler approach that preserves the actual text content
        // First, replace terminal commands that should be newlines
        let result = text
            // Add proper newline after command sequences like "vi filename"
            .replace(/\$ ([a-z]+) ([^\n]+)([^\n]*)\x1B\[\?1049h/g, '$ $1 $2\n')
            
            // Handle ESC sequences
            .replace(/\x1B\[\?[0-9;]*[a-zA-Z]/g, '')    // Private mode sequences like [?1049h
            .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')     // CSI sequences
            .replace(/\x1B\][^\x07]*\x07/g, '')        // OSC sequences
            .replace(/\x1B[@A-Z\\^_`a-z{|}~]/g, '')    // Other ESC sequences
            
            // Handle terminal control sequences without the ESC prefix
            // These often appear after an ESC sequence was partially stripped
            .replace(/\[[\d;]*[A-Za-z]/g, '')         // Control sequences like [1B, [71D, etc.
            
            // Remove remaining control characters
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        
        // Fix common issues that occur after stripping
        result = result
            // Fix text that was merged due to lost newlines
            .replace(/\$ ([a-z]+) ([^ ]+)([^ ]*)version:/g, '$ $1 $2\nversion:')
            .replace(/([a-z]+)version:/g, '$1\nversion:')
        
        return result
    }

    selectAllText(): void {
        if (this.textAreaRef?.nativeElement) {
            this.textAreaRef.nativeElement.select()
        }
    }

    async copyText(): Promise<void> {
        // Copy the current text from the textarea (which may include user edits)
        const currentText = this.textAreaRef.nativeElement.value
        await navigator.clipboard.writeText(currentText)
    }

    close(): void {
        this.resumeHotkeys()
        this.activeModal.close()
    }

    /**
     * Handle checkbox toggle for ANSI stripping
     */
    onStripAnsiToggle(): void {
        // When toggling, we want to reset to the processed text
        this.updateDisplayText()
    }
} 