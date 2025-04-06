import { Component, OnInit } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

export interface DownloadFilterConfig {
    includePatterns: string[]
    excludePatterns: string[]
    recursive: boolean
    skipEmptyFolders: boolean
}

const STORAGE_KEY = 'tabby-sftp-download-filter-config'

/**
 * Modal dialog cho phép người dùng cấu hình bộ lọc khi tải xuống file/thư mục
 */
@Component({
    selector: 'sftp-download-filter-modal',
    template: require('./sftpDownloadFilterModal.component.pug'),
})
export class SFTPDownloadFilterModalComponent implements OnInit {
    includeInput = ''
    excludeInput = ''
    config: DownloadFilterConfig = {
        includePatterns: [],
        excludePatterns: [],
        recursive: true,
        skipEmptyFolders: true,
    }

    constructor(
        public modal: NgbActiveModal,
    ) { }

    ngOnInit(): void {
        // Tải cấu hình từ localStorage khi component được khởi tạo
        this.loadConfigFromStorage()
    }

    private loadConfigFromStorage(): void {
        try {
            const savedConfig = window.localStorage.getItem(STORAGE_KEY)
            if (savedConfig) {
                const parsedConfig = JSON.parse(savedConfig) as DownloadFilterConfig
                // Đảm bảo tất cả các trường đều tồn tại
                this.config = {
                    includePatterns: parsedConfig.includePatterns || [],
                    excludePatterns: parsedConfig.excludePatterns || [],
                    recursive: parsedConfig.recursive !== undefined ? parsedConfig.recursive : true,
                    skipEmptyFolders: parsedConfig.skipEmptyFolders !== undefined ? parsedConfig.skipEmptyFolders : true,
                }
            }
        } catch (error) {
            console.error('Failed to load filter config from localStorage:', error)
            // Nếu có lỗi, sử dụng cấu hình mặc định
        }
    }

    private saveConfigToStorage(): void {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config))
        } catch (error) {
            console.error('Failed to save filter config to localStorage:', error)
        }
    }

    addIncludePattern(): void {
        if (this.includeInput.trim()) {
            this.config.includePatterns.push(this.includeInput.trim())
            this.includeInput = ''
            this.saveConfigToStorage()
        }
    }

    removeIncludePattern(pattern: string): void {
        this.config.includePatterns = this.config.includePatterns.filter(p => p !== pattern)
        this.saveConfigToStorage()
    }

    addExcludePattern(): void {
        if (this.excludeInput.trim()) {
            this.config.excludePatterns.push(this.excludeInput.trim())
            this.excludeInput = ''
            this.saveConfigToStorage()
        }
    }

    removeExcludePattern(pattern: string): void {
        this.config.excludePatterns = this.config.excludePatterns.filter(p => p !== pattern)
        this.saveConfigToStorage()
    }

    onRecursiveChange(): void {
        this.saveConfigToStorage()
    }

    onSkipEmptyFoldersChange(): void {
        this.saveConfigToStorage()
    }

    save(): void {
        // Thêm patterns từ input fields nếu chúng chưa được thêm vào
        if (this.includeInput.trim()) {
            this.addIncludePattern()
        }
        if (this.excludeInput.trim()) {
            this.addExcludePattern()
        }
        // Lưu cấu hình cuối cùng vào localStorage
        this.saveConfigToStorage()
        this.modal.close(this.config)
    }

    cancel(): void {
        this.modal.dismiss()
    }
} 