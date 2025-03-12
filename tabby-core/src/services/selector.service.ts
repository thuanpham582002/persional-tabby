import { Injectable } from '@angular/core'
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap'

import { SelectorModalComponent } from '../components/selectorModal.component'
import { SelectorOption } from '../api/selector'

@Injectable({ providedIn: 'root' })
export class SelectorService {
    private current: NgbModalRef|null = null

    get active (): boolean {
        return !!this.current
    }

    /** @hidden */
    private constructor (
        private ngbModal: NgbModal,
    ) { }

    /**
     * Show a selector with the given options
     * @param name Title of the selector
     * @param options List of options to display
     * @param sortDesc If true, sort options by weight in descending order (default: false - ascending)
     */
    show <T> (name: string, options: SelectorOption<T>[], sortDesc: boolean = false): Promise<T> {
        const modal = this.ngbModal.open(SelectorModalComponent)
        this.current = modal
        modal.result.finally(() => {
            this.current = null
        })
        const instance: SelectorModalComponent<T> = modal.componentInstance
        instance.name = name
        instance.options = options
        instance.sortDesc = sortDesc
        return modal.result as Promise<T>
    }
}
