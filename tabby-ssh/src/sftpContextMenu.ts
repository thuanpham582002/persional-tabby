import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { MenuItemOptions, PlatformService, TranslateService } from 'tabby-core'
import { SFTPSession, SFTPFile } from './session/sftp'
import { SFTPContextMenuItemProvider } from './api'
import { SFTPDeleteModalComponent } from './components/sftpDeleteModal.component'
import { SFTPPanelComponent } from './components/sftpPanel.component'
import { DownloadFilterConfig, SFTPDownloadFilterModalComponent } from './components/sftpDownloadFilterModal.component'
import path from 'path'
import JSZip from 'jszip'

// Key cho localStorage - phải khớp với STORAGE_KEY trong các file khác
const STORAGE_KEY = 'tabby-sftp-download-filter-config'

/** @hidden */
@Injectable()
export class CommonSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 10

    constructor (
        private platform: PlatformService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
    ) {
        super()
    }

    /**
     * Tải cấu hình bộ lọc từ localStorage hoặc trả về cấu hình mặc định nếu không có
     */
    private getFilterConfigFromStorage(): DownloadFilterConfig {
        try {
            const savedConfig = window.localStorage.getItem(STORAGE_KEY)
            if (savedConfig) {
                const parsedConfig = JSON.parse(savedConfig) as DownloadFilterConfig
                return {
                    includePatterns: parsedConfig.includePatterns || [],
                    excludePatterns: parsedConfig.excludePatterns || [],
                    recursive: parsedConfig.recursive !== undefined ? parsedConfig.recursive : true,
                    skipEmptyFolders: parsedConfig.skipEmptyFolders !== undefined ? parsedConfig.skipEmptyFolders : true,
                }
            }
        } catch (error) {
            console.error('Failed to load filter config from localStorage:', error)
        }
        
        // Cấu hình mặc định nếu không tìm thấy trong localStorage
        return {
            includePatterns: [],
            excludePatterns: [],
            recursive: true,
            skipEmptyFolders: true
        }
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        return [
            {
                click: async () => {
                    await panel.openCreateDirectoryModal()
                },
                label: this.translate.instant('Create directory'),
            },
            {
                click: async () => {
                    if (item.isDirectory) {
                        // Thực hiện tải xuống thư mục
                        try {
                            // Hiển thị hộp thoại xác nhận
                            const result = await this.platform.showMessageBox({
                                type: 'warning',
                                message: this.translate.instant('Downloading directory'),
                                detail: this.translate.instant('Please select a destination folder'),
                                buttons: [
                                    this.translate.instant('Select folder'),
                                    this.translate.instant('Cancel'),
                                    this.translate.instant('Configure Filter')
                                ],
                                defaultId: 0,
                                cancelId: 1,
                            })
                            
                            if (result.response === 1) { // Cancel
                                return
                            }
                            
                            // Nếu người dùng chọn "Configure Filter", hiển thị dialog cấu hình
                            let filterConfig: DownloadFilterConfig = this.getFilterConfigFromStorage()
                            
                            if (result.response === 2) { // Configure Filter
                                const filterModal = this.ngbModal.open(SFTPDownloadFilterModalComponent, { size: 'lg' })
                                try {
                                    filterConfig = await filterModal.result
                                } catch {
                                    // Người dùng đã cancel modal
                                    return
                                }
                            }
                            
                            // Sử dụng PlatformService để chọn thư mục đích
                            const targetDirectory = await this.platform.pickDirectory()
                            if (!targetDirectory) {
                                return
                            }
                            
                            panel.isDownloading = true
                            panel.cancelDownload = false
                            panel.downloadProgress = {
                                total: 0,
                                completed: 0,
                                currentFile: '',
                            }
                            
                            panel.notifications.info(this.translate.instant('Downloading folder, please wait...'))
                            
                            // Tính tổng số file cần tải xuống
                            await panel.countFilesRecursive(item.fullPath, filterConfig)
                            
                            const files = await panel.sftp.readdir(item.fullPath)
                            
                            try {
                                // Đệ quy tải xuống thư mục và tất cả nội dung của nó
                                await panel.downloadFolderRecursive(item.fullPath, targetDirectory, files, filterConfig)
                                
                                if (panel.cancelDownload) {
                                    panel.notifications.info(this.translate.instant('Download canceled'))
                                } else {
                                    panel.notifications.notice(this.translate.instant('Folder downloaded successfully'))
                                }
                            } finally {
                                panel.isDownloading = false
                                panel.cancelDownload = false
                            }
                        } catch (error) {
                            panel.isDownloading = false
                            panel.cancelDownload = false
                            panel.notifications.error(`${this.translate.instant('Failed to download folder')}: ${error.message}`)
                        }
                    } else {
                        // Thực hiện tải xuống file
                        await panel.download(item.fullPath, item.mode, item.size)
                    }
                },
                label: this.translate.instant('Download'),
            },
            {
                click: async () => {
                    if (item.isDirectory) {
                        try {
                            // Hiển thị hộp thoại xác nhận
                            const result = await this.platform.showMessageBox({
                                type: 'warning',
                                message: this.translate.instant('Downloading directory as ZIP'),
                                detail: this.translate.instant('Please select a destination file'),
                                buttons: [
                                    this.translate.instant('Select location'),
                                    this.translate.instant('Cancel'),
                                    this.translate.instant('Configure Filter')
                                ],
                                defaultId: 0,
                                cancelId: 1,
                            })
                            
                            if (result.response === 1) { // Cancel
                                return
                            }
                            
                            // Nếu người dùng chọn "Configure Filter", hiển thị dialog cấu hình
                            let filterConfig: DownloadFilterConfig = this.getFilterConfigFromStorage()
                            
                            if (result.response === 2) { // Configure Filter
                                const filterModal = this.ngbModal.open(SFTPDownloadFilterModalComponent, { size: 'lg' })
                                try {
                                    filterConfig = await filterModal.result
                                } catch {
                                    // Người dùng đã cancel modal
                                    return
                                }
                            }
                            
                            // Lưu đường dẫn hiện tại
                            const currentPath = panel.path
                            
                            // Chuyển đến thư mục cần tải xuống
                            await panel.navigate(item.fullPath)
                            
                            // Sử dụng PlatformService để chọn vị trí lưu file ZIP
                            const folderName = path.basename(panel.path)
                            const targetFile = await panel.platform.pickDirectory()
                            
                            if (!targetFile) {
                                // Quay trở lại thư mục ban đầu
                                await panel.navigate(currentPath)
                                return
                            }
                            
                            // Tạo đường dẫn đầy đủ cho file ZIP
                            const fs = (window as any).require('fs')
                            let zipFilePath = path.join(targetFile, `${folderName}.zip`)
                            
                            // Kiểm tra xem file ZIP đã tồn tại chưa
                            if (fs.existsSync(zipFilePath)) {
                                // Hiển thị hộp thoại xác nhận
                                const fileExistsResult = await this.platform.showMessageBox({
                                    type: 'warning',
                                    message: this.translate.instant('File already exists'),
                                    detail: this.translate.instant('The file "{0}" already exists. What would you like to do?', zipFilePath),
                                    buttons: [
                                        this.translate.instant('Replace file'),
                                        this.translate.instant('Keep both (rename new file)'),
                                        this.translate.instant('Cancel')
                                    ],
                                    defaultId: 0,
                                    cancelId: 2,
                                })
                                
                                if (fileExistsResult.response === 2) { // Cancel
                                    // Quay trở lại thư mục ban đầu
                                    await panel.navigate(currentPath)
                                    return
                                }
                                
                                if (fileExistsResult.response === 1) { // Keep both
                                    // Tạo tên file mới
                                    let counter = 1
                                    const baseNameWithoutExt = folderName
                                    const ext = '.zip'
                                    let newFileName
                                    
                                    do {
                                        newFileName = `${baseNameWithoutExt} (${counter})${ext}`
                                        zipFilePath = path.join(targetFile, newFileName)
                                        counter++
                                    } while (fs.existsSync(zipFilePath))
                                }
                                // Nếu response === 0 thì sẽ ghi đè (Replace)
                            }
                            
                            panel.isDownloading = true
                            panel.cancelDownload = false
                            panel.downloadProgress = {
                                total: 0,
                                completed: 0,
                                currentFile: '',
                            }
                            
                            panel.notifications.info('Creating ZIP archive, please wait...')
                            
                            // Tính tổng số file cần thêm vào zip
                            await panel.countFilesRecursive(panel.path, filterConfig)
                            
                            // Tạo đối tượng ZIP
                            const zip = new JSZip()
                            
                            // Thêm các file vào ZIP
                            await panel.addFolderToZip(zip, panel.path, '', filterConfig)
                            
                            if (panel.cancelDownload) {
                                panel.notifications.info('ZIP creation canceled')
                                panel.isDownloading = false
                                panel.cancelDownload = false
                                await panel.navigate(currentPath)
                                return
                            }
                            
                            panel.downloadProgress.currentFile = 'Creating ZIP file...'
                            
                            // Tạo file ZIP
                            const zipContent = await zip.generateAsync({
                                type: 'nodebuffer',
                                compression: 'DEFLATE',
                                compressionOptions: { level: 6 },
                            })
                            
                            if (panel.cancelDownload) {
                                panel.notifications.info('ZIP creation canceled')
                                panel.isDownloading = false
                                panel.cancelDownload = false
                                await panel.navigate(currentPath)
                                return
                            }
                            
                            // Lưu file ZIP
                            fs.writeFileSync(zipFilePath, zipContent)
                            
                            panel.notifications.notice(`${this.translate.instant('ZIP archive created successfully')}: ${path.basename(zipFilePath)}`)
                            
                            // Quay trở lại thư mục ban đầu
                            await panel.navigate(currentPath)
                        } catch (error) {
                            panel.notifications.error(`${this.translate.instant('Failed to download as ZIP')}: ${error.message}`)
                        }
                    }
                },
                label: this.translate.instant('Download as ZIP'),
                enabled: item.isDirectory,
            },
            {
                click: async () => {
                    if ((await this.platform.showMessageBox({
                        type: 'warning',
                        message: this.translate.instant('Delete {fullPath}?', item),
                        defaultId: 0,
                        cancelId: 1,
                        buttons: [
                            this.translate.instant('Delete'),
                            this.translate.instant('Cancel'),
                        ],
                    })).response === 0) {
                        await this.deleteItem(item, panel.sftp)
                        panel.navigate(panel.path)
                    }
                },
                label: this.translate.instant('Delete'),
            },
        ]
    }

    async deleteItem (item: SFTPFile, session: SFTPSession): Promise<void> {
        const modal = this.ngbModal.open(SFTPDeleteModalComponent)
        modal.componentInstance.item = item
        modal.componentInstance.sftp = session
        await modal.result.catch(() => null)
    }
}
