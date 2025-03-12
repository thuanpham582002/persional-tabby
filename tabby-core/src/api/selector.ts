/**
 * Defines the types of selectors available in the application
 */
export enum SelectorType {
    /** Default selector for selecting profiles */
    SelectProfile = 'select-profile',
    /** Selector for recent tabs */
    RecentTabs = 'recent-tabs'
}

/**
 * An individual selector option
 */
export interface SelectorOption<T = any> {
    name: string
    description?: string
    group?: string
    result?: T
    icon?: string
    freeInputPattern?: string
    freeInputEquivalent?: string
    color?: string
    weight?: number
    callback?: (string?) => void
}
