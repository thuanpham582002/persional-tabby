import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { MenuItemOptions, PlatformService, TranslateService } from 'tabby-core'
import { SFTPSession, SFTPFile } from './session/sftp'
import { SFTPContextMenuItemProvider } from './api'
import { SFTPDeleteModalComponent } from './components/sftpDeleteModal.component'
import { SFTPPanelComponent } from './components/sftpPanel.component'


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
                                ],
                                defaultId: 0,
                                cancelId: 1,
                            })
                            
                            if (result.response !== 0) {
                                return
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
                            await panel.countFilesRecursive(item.fullPath)
                            
                            const files = await panel.sftp.readdir(item.fullPath)
                            
                            try {
                                // Đệ quy tải xuống thư mục và tất cả nội dung của nó
                                await panel.downloadFolderRecursive(item.fullPath, targetDirectory, files)
                                
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
                            // Tải xuống thư mục dưới dạng ZIP
                            // Lưu đường dẫn hiện tại
                            const currentPath = panel.path
                            
                            // Chuyển đến thư mục cần tải xuống
                            await panel.navigate(item.fullPath)
                            
                            // Thực hiện tải xuống dưới dạng ZIP
                            await panel.downloadFolderAsZip()
                            
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
