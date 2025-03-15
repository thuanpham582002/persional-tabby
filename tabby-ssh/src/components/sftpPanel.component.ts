import * as C from 'constants'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional } from '@angular/core'
import { FileUpload, DirectoryUpload, MenuItemOptions, NotificationsService, PlatformService } from 'tabby-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'
import JSZip from 'jszip'

interface PathSegment {
    name: string
    path: string
}

@Component({
    selector: 'sftp-panel',
    templateUrl: './sftpPanel.component.pug',
    styleUrls: ['./sftpPanel.component.scss'],
})
export class SFTPPanelComponent {
    @Input() session: SSHSession
    @Output() closed = new EventEmitter<void>()
    sftp: SFTPSession
    fileList: SFTPFile[]|null = null
    @Input() path = '/'
    @Output() pathChange = new EventEmitter<string>()
    pathSegments: PathSegment[] = []
    @Input() cwdDetectionAvailable = false
    editingPath: string|null = null
    directoryInput = ''
    
    isDownloading = false
    cancelDownload = false
    downloadProgress = {
        total: 0,
        completed: 0,
        currentFile: '',
    }

    constructor (
        private ngbModal: NgbModal,
        public notifications: NotificationsService,
        public platform: PlatformService,
        @Optional() @Inject(SFTPContextMenuItemProvider) protected contextMenuProviders: SFTPContextMenuItemProvider[],
    ) {
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
    }

    async ngOnInit (): Promise<void> {
        this.sftp = await this.session.openSFTP()
        try {
            await this.navigate(this.path)
        } catch (error) {
            console.warn('Could not navigate to', this.path, ':', error)
            this.notifications.error(error.message)
            await this.navigate('/')
        }
    }

    async navigate (newPath: string, fallbackOnError = true): Promise<void> {
        const previousPath = this.path
        this.path = newPath
        this.pathChange.next(this.path)

        let p = newPath
        this.pathSegments = []
        while (p !== '/') {
            this.pathSegments.unshift({
                name: path.basename(p),
                path: p,
            })
            p = path.dirname(p)
        }

        this.fileList = null
        try {
            this.fileList = await this.sftp.readdir(this.path)
        } catch (error) {
            this.notifications.error(error.message)
            if (previousPath && fallbackOnError) {
                this.navigate(previousPath, false)
            }
            return
        }

        const dirKey = a => a.isDirectory ? 1 : 0
        this.fileList.sort((a, b) =>
            dirKey(b) - dirKey(a) ||
            a.name.localeCompare(b.name))
    }

    getFileType (fileExtension: string): string {
        const codeExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'h', 'cs', 'html', 'css', 'rb', 'php', 'swift', 'go', 'kt', 'sh', 'json', 'cc', 'c', 'xml']
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp']
        const pdfExtensions = ['pdf']
        const archiveExtensions = ['zip', 'rar', 'tar', 'gz']
        const wordExtensions = ['doc', 'docx']
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov']
        const powerpointExtensions = ['ppt', 'pptx']
        const textExtensions = ['txt', 'log']
        const audioExtensions = ['mp3', 'wav', 'flac']
        const excelExtensions = ['xls', 'xlsx']

        const lowerCaseExtension = fileExtension.toLowerCase()

        if (codeExtensions.includes(lowerCaseExtension)) {
            return 'code'
        } else if (imageExtensions.includes(lowerCaseExtension)) {
            return 'image'
        } else if (pdfExtensions.includes(lowerCaseExtension)) {
            return 'pdf'
        } else if (archiveExtensions.includes(lowerCaseExtension)) {
            return 'archive'
        } else if (wordExtensions.includes(lowerCaseExtension)) {
            return 'word'
        } else if (videoExtensions.includes(lowerCaseExtension)) {
            return 'video'
        } else if (powerpointExtensions.includes(lowerCaseExtension)) {
            return 'powerpoint'
        } else if (textExtensions.includes(lowerCaseExtension)) {
            return 'text'
        } else if (audioExtensions.includes(lowerCaseExtension)) {
            return 'audio'
        } else if (excelExtensions.includes(lowerCaseExtension)) {
            return 'excel'
        } else {
            return 'unknown'
        }
    }

    getIcon (item: SFTPFile): string {
        if (item.isDirectory) {
            return 'fas fa-folder text-info'
        }
        if (item.isSymlink) {
            return 'fas fa-link text-warning'
        }
        const fileMatch = /\.([^.]+)$/.exec(item.name)
        const extension = fileMatch ? fileMatch[1] : null
        if (extension !== null) {
            const fileType = this.getFileType(extension)

            switch (fileType) {
                case 'unknown':
                    return 'fas fa-file'
                default:
                    return `fa-solid fa-file-${fileType} `
            }
        }
        return 'fas fa-file'
    }

    goUp (): void {
        this.navigate(path.dirname(this.path))
    }

    async open (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.navigate(item.fullPath)
        } else if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.navigate(item.fullPath)
            } else {
                await this.download(item.fullPath, stat.mode, stat.size)
            }
        } else {
            await this.download(item.fullPath, item.mode, item.size)
        }
    }

    async openCreateDirectoryModal (): Promise<void> {
        const modal = this.ngbModal.open(SFTPCreateDirectoryModalComponent)
        const directoryName = await modal.result.catch(() => null)
        if (directoryName?.trim()) {
            this.sftp.mkdir(path.join(this.path, directoryName)).then(() => {
                this.notifications.notice('The directory was created successfully')
                this.navigate(path.join(this.path, directoryName))
            }).catch(() => {
                this.notifications.error('The directory could not be created')
            })
        }
    }

    async upload (): Promise<void> {
        const transfers = await this.platform.startUpload({ multiple: true })
        await Promise.all(transfers.map(t => this.uploadOne(t)))
    }

    async uploadFolder (): Promise<void> {
        const transfer = await this.platform.startUploadDirectory()
        await this.uploadOneFolder(transfer)
    }

    async uploadOneFolder (transfer: DirectoryUpload, accumPath = ''): Promise<void> {
        const savedPath = this.path
        for(const t of transfer.getChildrens()) {
            if (t instanceof DirectoryUpload) {
                try {
                    await this.sftp.mkdir(path.posix.join(this.path, accumPath, t.getName()))
                } catch {
                    // Intentionally ignoring errors from making duplicate dirs.
                }
                await this.uploadOneFolder(t, path.posix.join(accumPath, t.getName()))
            } else {
                await this.sftp.upload(path.posix.join(this.path, accumPath, t.getName()), t)
            }
        }
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async uploadOne (transfer: FileUpload): Promise<void> {
        const savedPath = this.path
        await this.sftp.upload(path.join(this.path, transfer.getName()), transfer)
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async download (itemPath: string, mode: number, size: number): Promise<void> {
        const transfer = await this.platform.startDownload(path.basename(itemPath), mode, size)
        if (!transfer) {
            return
        }
        this.sftp.download(itemPath, transfer)
    }

    getModeString (item: SFTPFile): string {
        const s = 'SGdrwxrwxrwx'
        const e = '   ---------'
        const c = [
            0o4000, 0o2000, C.S_IFDIR,
            C.S_IRUSR, C.S_IWUSR, C.S_IXUSR,
            C.S_IRGRP, C.S_IWGRP, C.S_IXGRP,
            C.S_IROTH, C.S_IWOTH, C.S_IXOTH,
        ]
        let result = ''
        for (let i = 0; i < c.length; i++) {
            result += item.mode & c[i] ? s[i] : e[i]
        }
        return result
    }

    async buildContextMenu (item: SFTPFile): Promise<MenuItemOptions[]> {
        let items: MenuItemOptions[] = []
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(item, this)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    async showContextMenu (item: SFTPFile, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.platform.popupContextMenu(await this.buildContextMenu(item), event)
    }

    get shouldShowCWDTip (): boolean {
        return !window.localStorage.sshCWDTipDismissed
    }

    dismissCWDTip (): void {
        window.localStorage.sshCWDTipDismissed = 'true'
    }

    editPath (): void {
        this.editingPath = this.path
    }

    confirmPath (): void {
        if (this.editingPath === null) {
            return
        }
        this.navigate(this.editingPath)
        this.editingPath = null
    }

    close (): void {
        this.closed.emit()
    }

    async navigateToInput (): Promise<void> {
        if (this.directoryInput) {
            try {
                // Kiểm tra trước xem đường dẫn có tồn tại không
                this.notifications.info(`Checking if path exists: ${this.directoryInput}`)
                
                try {
                    // Thử stat đường dẫn để kiểm tra xem nó có tồn tại không
                    const stat = await this.sftp.stat(this.directoryInput)
                    
                    // Đảm bảo đây là thư mục, không phải file
                    if (!stat.isDirectory) {
                        this.notifications.error(`Path is not a directory: ${this.directoryInput}`)
                        return
                    }
                    
                    // Nếu tồn tại, tiến hành điều hướng
                    await this.navigate(this.directoryInput)
                    this.directoryInput = ''
                } catch (error) {
                    // Đường dẫn không tồn tại
                    this.notifications.error(`Directory does not exist: ${this.directoryInput}`)
                }
            } catch (error) {
                this.notifications.error(`Failed to navigate: ${error.message}`)
            }
        }
    }

    async downloadFolder (): Promise<void> {
        try {
            // Hiển thị hộp thoại xác nhận
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: 'Downloading directory',
                detail: 'Please select a destination folder',
                buttons: [
                    'Select folder',
                    'Cancel',
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
            
            this.isDownloading = true
            this.cancelDownload = false
            this.downloadProgress = {
                total: 0,
                completed: 0,
                currentFile: '',
            }
            
            this.notifications.info('Downloading folder, please wait...')
            
            // Tính tổng số file cần tải xuống
            await this.countFilesRecursive(this.path)
            
            // Lấy danh sách tất cả các file trong thư mục hiện tại
            const files = await this.sftp.readdir(this.path)
            
            try {
                // Đệ quy tải xuống thư mục và tất cả nội dung của nó
                await this.downloadFolderRecursive(this.path, targetDirectory, files)
                
                if (this.cancelDownload) {
                    this.notifications.info('Download canceled')
                } else {
                    this.notifications.notice('Folder downloaded successfully')
                }
            } finally {
                this.isDownloading = false
                this.cancelDownload = false
            }
        } catch (error) {
            this.isDownloading = false
            this.cancelDownload = false
            this.notifications.error(`Failed to download folder: ${error.message}`)
        }
    }
    
    cancelDownloadProcess (): void {
        this.cancelDownload = true
        this.notifications.info('Canceling download, please wait...')
    }
    
    async countFilesRecursive (remotePath: string): Promise<number> {
        let count = 0
        const files = await this.sftp.readdir(remotePath)
        
        for (const file of files) {
            if (file.isDirectory) {
                count += await this.countFilesRecursive(path.join(remotePath, file.name))
            } else {
                count++
            }
        }
        
        this.downloadProgress.total = count
        return count
    }
    
    async downloadFolderRecursive (remotePath: string, localPath: string, items?: SFTPFile[]): Promise<void> {
        if (this.cancelDownload) {
            return
        }
        
        const files = items || await this.sftp.readdir(remotePath)
        
        for (const file of files) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteFilePath = path.join(remotePath, file.name)
            const localFilePath = path.join(localPath, file.name)
            
            if (file.isDirectory) {
                // Tạo thư mục con trên máy tính cục bộ
                const fs = (window as any).require('fs')
                if (!fs.existsSync(localFilePath)) {
                    fs.mkdirSync(localFilePath, { recursive: true })
                }
                
                // Tải xuống nội dung của thư mục con
                await this.downloadFolderRecursive(remoteFilePath, localFilePath)
            } else {
                // Tải xuống file
                try {
                    this.downloadProgress.currentFile = file.name
                    const transfer = await this.platform.startDownload(file.name, file.mode, file.size)
                    if (transfer) {
                        await new Promise<void>((resolve) => {
                            if (this.cancelDownload) {
                                transfer.cancel()
                                resolve()
                                return
                            }
                            
                            // Tạo một interval để kiểm tra tiến trình
                            const checkInterval = setInterval(() => {
                                if (this.cancelDownload) {
                                    clearInterval(checkInterval)
                                    transfer.cancel()
                                    resolve()
                                }
                                
                                if (transfer.isComplete()) {
                                    clearInterval(checkInterval)
                                    this.downloadProgress.completed++
                                    resolve()
                                }
                            }, 200)
                            
                            this.sftp.download(remoteFilePath, transfer)
                        })
                    }
                } catch (error) {
                    if (this.cancelDownload) {
                        return
                    }
                    console.error(`Error downloading ${remoteFilePath}:`, error)
                    throw error
                }
            }
        }
    }

    async downloadFolderAsZip (): Promise<void> {
        try {
            // Hiển thị hộp thoại xác nhận
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: 'Downloading directory as ZIP',
                detail: 'Please select a destination file',
                buttons: [
                    'Select location',
                    'Cancel',
                ],
                defaultId: 0,
                cancelId: 1,
            })
            
            if (result.response !== 0) {
                return
            }
            
            // Sử dụng PlatformService để chọn vị trí lưu file ZIP
            const folderName = path.basename(this.path)
            const targetFile = await this.platform.pickDirectory()
            
            if (!targetFile) {
                return
            }
            
            // Tạo đường dẫn đầy đủ cho file ZIP
            const fs = (window as any).require('fs')
            const zipFilePath = path.join(targetFile, `${folderName}.zip`)
            
            this.isDownloading = true
            this.cancelDownload = false
            this.downloadProgress = {
                total: 0,
                completed: 0,
                currentFile: '',
            }
            
            this.notifications.info('Creating ZIP archive, please wait...')
            
            // Tính tổng số file cần thêm vào zip
            await this.countFilesRecursive(this.path)
            
            // Tạo đối tượng ZIP
            const zip = new JSZip()
            
            // Thêm các file vào ZIP
            await this.addFolderToZip(zip, this.path, '')
            
            if (this.cancelDownload) {
                this.notifications.info('ZIP creation canceled')
                this.isDownloading = false
                this.cancelDownload = false
                return
            }
            
            this.downloadProgress.currentFile = 'Creating ZIP file...'
            
            // Tạo file ZIP
            const zipContent = await zip.generateAsync({
                type: 'nodebuffer',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 },
            })
            
            if (this.cancelDownload) {
                this.notifications.info('ZIP creation canceled')
                this.isDownloading = false
                this.cancelDownload = false
                return
            }
            
            // Lưu file ZIP
            fs.writeFileSync(zipFilePath, zipContent)
            
            this.notifications.notice('ZIP archive created successfully')
        } catch (error) {
            this.notifications.error(`Failed to create ZIP archive: ${error.message}`)
        } finally {
            this.isDownloading = false
            this.cancelDownload = false
        }
    }

    async addFolderToZip (zip: JSZip, remotePath: string, zipPath: string): Promise<void> {
        if (this.cancelDownload) {
            return
        }
        
        const files = await this.sftp.readdir(remotePath)
        
        for (const file of files) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteFilePath = path.join(remotePath, file.name)
            const zipFilePath = zipPath ? path.join(zipPath, file.name) : file.name
            
            this.downloadProgress.currentFile = file.name
            
            if (file.isDirectory) {
                // Tạo thư mục trong ZIP
                const folder = zip.folder(zipFilePath)
                if (folder) {
                    // Thêm nội dung của thư mục con vào ZIP
                    await this.addFolderToZip(zip, remoteFilePath, zipFilePath)
                }
            } else {
                try {
                    // Tạo một transfer để tải file về trước khi thêm vào ZIP
                    const tempBuffer: Buffer[] = []
                    
                    // Tải file từ SFTP
                    const handle = await this.sftp.open(remoteFilePath, 0)
                    while (true) {
                        const chunk = await handle.read()
                        if (!chunk.length) {
                            break
                        }
                        tempBuffer.push(Buffer.from(chunk))
                    }
                    await handle.close()
                    
                    // Ghép các phần của file
                    const fileContent = Buffer.concat(tempBuffer)
                    
                    // Thêm file vào ZIP
                    zip.file(zipFilePath, fileContent)
                    
                    // Cập nhật tiến trình
                    this.downloadProgress.completed++
                } catch (error) {
                    if (this.cancelDownload) {
                        return
                    }
                    console.error(`Error adding ${remoteFilePath} to ZIP:`, error)
                    throw error
                }
            }
        }
    }
}
