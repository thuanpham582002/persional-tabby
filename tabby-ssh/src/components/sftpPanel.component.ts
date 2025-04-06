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
import { DownloadFilterConfig, SFTPDownloadFilterModalComponent } from './sftpDownloadFilterModal.component'

// Key cho localStorage - phải khớp với STORAGE_KEY trong sftpDownloadFilterModal.component.ts
const STORAGE_KEY = 'tabby-sftp-download-filter-config'

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
                    'Configure Filter'
                ],
                defaultId: 0,
                cancelId: 1,
            })
            
            if (result.response === 1) { // Cancel
                return
            }
            
            // Nếu người dùng chọn "Configure Filter", hiển thị dialog cấu hình
            // Nếu không, sử dụng cấu hình từ localStorage
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
            
            this.isDownloading = true
            this.cancelDownload = false
            this.downloadProgress = {
                total: 0,
                completed: 0,
                currentFile: '',
            }
            
            this.notifications.info('Downloading folder, please wait...')
            
            // Tính tổng số file cần tải xuống (dựa trên bộ lọc)
            await this.countFilesRecursive(this.path, filterConfig)
            
            // Lấy danh sách tất cả các file trong thư mục hiện tại
            const files = await this.sftp.readdir(this.path)
            
            try {
                // Đệ quy tải xuống thư mục và tất cả nội dung của nó
                await this.downloadFolderRecursive(this.path, targetDirectory, files, filterConfig)
                
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
    
    async countFilesRecursive (remotePath: string, filterConfig: DownloadFilterConfig = { includePatterns: [], excludePatterns: [], recursive: true, skipEmptyFolders: true }): Promise<number> {
        let count = 0
        const files = await this.sftp.readdir(remotePath)
        
        for (const file of files) {
            if (file.isDirectory) {
                if (filterConfig.recursive) {
                    count += await this.countFilesRecursive(path.join(remotePath, file.name), filterConfig)
                }
            } else {
                if (this.matchesFilter(path.join(remotePath, file.name), filterConfig)) {
                    count++
                }
            }
        }
        
        this.downloadProgress.total = count
        return count
    }
    
    async downloadFolderRecursive (remotePath: string, localPath: string, items?: SFTPFile[], filterConfig: DownloadFilterConfig = { includePatterns: [], excludePatterns: [], recursive: true, skipEmptyFolders: true }): Promise<void> {
        if (this.cancelDownload) {
            return
        }
        
        const files = items || await this.sftp.readdir(remotePath)
        
        // Đếm số file sẽ được tải trong thư mục hiện tại
        let filesCount = 0
        const subfolders: SFTPFile[] = []
        
        // Đầu tiên, đếm các file sẽ được tải trong thư mục hiện tại và liệt kê các thư mục con
        for (const file of files) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteFilePath = path.join(remotePath, file.name)
            
            if (file.isDirectory) {
                if (filterConfig.recursive) {
                    subfolders.push(file)
                }
            } else {
                if (this.matchesFilter(remoteFilePath, filterConfig)) {
                    filesCount++
                }
            }
        }
        
        // Tạo thư mục hiện tại chỉ khi có file để tải hoặc không bỏ qua thư mục trống
        if (filesCount > 0 || !filterConfig.skipEmptyFolders) {
            // Tạo thư mục trên máy tính cục bộ
            const fs = (window as any).require('fs')
            if (!fs.existsSync(localPath)) {
                fs.mkdirSync(localPath, { recursive: true })
            }
        }
        
        // Tải các file trong thư mục hiện tại
        for (const file of files) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteFilePath = path.join(remotePath, file.name)
            const localFilePath = path.join(localPath, file.name)
            
            if (!file.isDirectory && this.matchesFilter(remoteFilePath, filterConfig)) {
                // Tải xuống file
                try {
                    this.downloadProgress.currentFile = file.name
                    
                    // Đảm bảo thư mục cha đã được tạo (trong trường hợp filesCount = 0 và skipEmptyFolders = true)
                    const fs = (window as any).require('fs')
                    const parentDir = path.dirname(localFilePath)
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true })
                    }
                    
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
        
        // Xử lý các thư mục con
        for (const subfolder of subfolders) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteSubPath = path.join(remotePath, subfolder.name)
            const localSubPath = path.join(localPath, subfolder.name)
            
            // Đệ quy vào thư mục con
            await this.downloadFolderRecursive(remoteSubPath, localSubPath, [], filterConfig)
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
                    'Configure Filter'
                ],
                defaultId: 0,
                cancelId: 1,
            })
            
            if (result.response === 1) { // Cancel
                return
            }
            
            // Nếu người dùng chọn "Configure Filter", hiển thị dialog cấu hình
            // Nếu không, sử dụng cấu hình từ localStorage
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
            
            // Sử dụng PlatformService để chọn vị trí lưu file ZIP
            const folderName = path.basename(this.path)
            const targetFile = await this.platform.pickDirectory()
            
            if (!targetFile) {
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
                    message: 'File already exists',
                    detail: `The file "${zipFilePath}" already exists. What would you like to do?`,
                    buttons: [
                        'Replace file',
                        'Keep both (rename new file)',
                        'Cancel'
                    ],
                    defaultId: 0,
                    cancelId: 2,
                })
                
                if (fileExistsResult.response === 2) { // Cancel
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
            
            this.isDownloading = true
            this.cancelDownload = false
            this.downloadProgress = {
                total: 0,
                completed: 0,
                currentFile: '',
            }
            
            this.notifications.info('Creating ZIP archive, please wait...')
            
            // Tính tổng số file cần thêm vào zip (dựa trên bộ lọc)
            await this.countFilesRecursive(this.path, filterConfig)
            
            // Tạo đối tượng ZIP
            const zip = new JSZip()
            
            // Thêm các file vào ZIP
            await this.addFolderToZip(zip, this.path, '', filterConfig)
            
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
            
            this.notifications.notice(`ZIP archive created successfully: ${path.basename(zipFilePath)}`)
        } catch (error) {
            this.notifications.error(`Failed to create ZIP archive: ${error.message}`)
        } finally {
            this.isDownloading = false
            this.cancelDownload = false
        }
    }

    async addFolderToZip (zip: JSZip, remotePath: string, zipPath: string, filterConfig: DownloadFilterConfig): Promise<void> {
        if (this.cancelDownload) {
            return
        }
        
        const files = await this.sftp.readdir(remotePath)
        const subfolders: SFTPFile[] = []
        
        // Liệt kê các thư mục con và tìm kiếm file phù hợp
        let hasMatchingFiles = false
        
        // Đầu tiên, kiểm tra các file trong thư mục hiện tại
        for (const file of files) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteFilePath = path.join(remotePath, file.name)
            
            if (file.isDirectory) {
                if (filterConfig.recursive) {
                    subfolders.push(file)
                }
            } else {
                if (this.matchesFilter(remoteFilePath, filterConfig)) {
                    hasMatchingFiles = true
                    // Không cần dừng vòng lặp, vì chúng ta cần thu thập tất cả các thư mục con
                }
            }
        }
        
        // Thêm các file vào ZIP nếu có file phù hợp hoặc không bỏ qua thư mục trống
        if (hasMatchingFiles || !filterConfig.skipEmptyFolders) {
            for (const file of files) {
                if (this.cancelDownload) {
                    return
                }
                
                const remoteFilePath = path.join(remotePath, file.name)
                const zipFilePath = zipPath ? path.join(zipPath, file.name) : file.name
                
                this.downloadProgress.currentFile = file.name
                
                if (!file.isDirectory && this.matchesFilter(remoteFilePath, filterConfig)) {
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
        
        // Xử lý các thư mục con
        for (const subfolder of subfolders) {
            if (this.cancelDownload) {
                return
            }
            
            const remoteSubPath = path.join(remotePath, subfolder.name)
            const zipSubPath = zipPath ? path.join(zipPath, subfolder.name) : subfolder.name
            
            // Chỉ tạo thư mục và đệ quy vào thư mục con nếu không bỏ qua thư mục trống
            // hoặc thư mục có file cần tải
            const subFiles = await this.sftp.readdir(remoteSubPath)
            let hasSubMatchingFiles = false
            
            // Kiểm tra xem thư mục con có chứa file phù hợp với bộ lọc không
            for (const subFile of subFiles) {
                if (!subFile.isDirectory) {
                    const subFilePath = path.join(remoteSubPath, subFile.name)
                    if (this.matchesFilter(subFilePath, filterConfig)) {
                        hasSubMatchingFiles = true
                        break
                    }
                }
            }
            
            // Tìm kiếm đệ quy trong các thư mục con (nếu recursive)
            if (!hasSubMatchingFiles && filterConfig.recursive) {
                for (const subFile of subFiles) {
                    if (subFile.isDirectory) {
                        const subDirPath = path.join(remoteSubPath, subFile.name)
                        const subDirFiles = await this.sftp.readdir(subDirPath)
                        for (const subDirFile of subDirFiles) {
                            if (!subDirFile.isDirectory) {
                                const subDirFilePath = path.join(subDirPath, subDirFile.name)
                                if (this.matchesFilter(subDirFilePath, filterConfig)) {
                                    hasSubMatchingFiles = true
                                    break
                                }
                            }
                        }
                        if (hasSubMatchingFiles) break;
                    }
                }
            }
            
            // Chỉ đệ quy vào thư mục con nếu có file phù hợp hoặc không bỏ qua thư mục trống
            if (hasSubMatchingFiles || !filterConfig.skipEmptyFolders) {
                // Đệ quy vào thư mục con
                await this.addFolderToZip(zip, remoteSubPath, zipSubPath, filterConfig)
            }
        }
    }

    /**
     * Kiểm tra xem một file có khớp với các mẫu (patterns) trong filter không
     * @param filePath Đường dẫn của file cần kiểm tra
     * @param filterConfig Cấu hình bộ lọc
     * @returns true nếu file khớp với bộ lọc (nên được tải), false nếu không
     */
    private matchesFilter(filePath: string, filterConfig: DownloadFilterConfig): boolean {
        // Lấy tên file tương đối so với thư mục gốc đang download
        const fileName = path.basename(filePath);
        
        // Nếu không có include patterns, mọi file đều được chấp nhận ban đầu
        let included = filterConfig.includePatterns.length === 0;
        
        // Nếu có include patterns, kiểm tra xem file có khớp với bất kỳ pattern nào không
        for (const pattern of filterConfig.includePatterns) {
            if (this.matchPattern(filePath, pattern) || this.matchPattern(fileName, pattern)) {
                included = true;
                break;
            }
        }
        
        // Nếu file không nằm trong danh sách include, bỏ qua
        if (!included) {
            return false;
        }
        
        // Kiểm tra xem file có bị loại trừ bởi bất kỳ exclude pattern nào không
        for (const pattern of filterConfig.excludePatterns) {
            if (this.matchPattern(filePath, pattern) || this.matchPattern(fileName, pattern)) {
                return false;
            }
        }
        
        // File đã vượt qua tất cả các kiểm tra lọc
        return true;
    }
    
    /**
     * So khớp một chuỗi với một pattern kiểu glob (hỗ trợ wildcard * và ?)
     */
    private matchPattern(text: string, pattern: string): boolean {
        // Chuyển đổi pattern glob thành regex
        const regexPattern = pattern
            .replace(/\./g, '\\.')   // Escape dấu chấm
            .replace(/\*/g, '.*')    // * -> .*
            .replace(/\?/g, '.');    // ? -> .
        
        const regex = new RegExp(`^${regexPattern}$`, 'i');  // 'i' cho case-insensitive
        return regex.test(text);
    }
}
