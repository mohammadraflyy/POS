import { AppLogoIcon } from './app-logo-icon'

/** Height of the title bar row, in px. The main process paints the native
 *  minimise/maximise/close overlay at the same height on the right. */
export const TITLE_BAR_HEIGHT = 36

/**
 * Stands in for the hidden native title bar: a slim drag strip with the app
 * mark on the left, keeping the window controls out of the page header. It is
 * fixed so that page content keeps scrolling normally underneath it.
 */
export function TitleBar() {
  return (
    <div className="bg-sidebar fixed inset-x-0 top-0 z-50 flex h-9 items-center px-3 [-webkit-app-region:drag]">
      <AppLogoIcon className="size-3.5 fill-current opacity-60" />
    </div>
  )
}
