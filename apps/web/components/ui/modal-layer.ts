"use client"

import * as React from "react"

type PreventableLayerEvent = {
  defaultPrevented: boolean
  preventDefault: () => void
}

const modalLayerListeners = new Set<() => void>()
let modalLayerStack: string[] = []

export function useModalLayer() {
  const reactId = React.useId()
  const layerId = React.useMemo(
    () => `modal-layer-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [reactId]
  )
  const [isTopLayer, setIsTopLayer] = React.useState(false)

  React.useEffect(() => {
    modalLayerStack = modalLayerStack.filter((id) => id !== layerId)
    modalLayerStack.push(layerId)

    const update = () => {
      setIsTopLayer(modalLayerStack.at(-1) === layerId)
    }
    modalLayerListeners.add(update)
    notifyModalLayerListeners()
    update()

    return () => {
      modalLayerListeners.delete(update)
      modalLayerStack = modalLayerStack.filter((id) => id !== layerId)
      notifyModalLayerListeners()
    }
  }, [layerId])

  const preventIfCovered = React.useCallback(
    (event: PreventableLayerEvent) => {
      if (isModalBranchEvent(event)) {
        event.preventDefault()
        return true
      }
      if (event.defaultPrevented || isTopLayer) return false
      event.preventDefault()
      return true
    },
    [isTopLayer]
  )

  return {
    isTopLayer,
    layerId,
    preventIfCovered,
  }
}

function notifyModalLayerListeners() {
  for (const listener of modalLayerListeners) {
    listener()
  }
}

function isModalBranchEvent(event: PreventableLayerEvent) {
  const target = getOriginalEventTarget(event)
  if (!target || !("closest" in target)) return false
  return Boolean(
    (target as Element).closest(
      '[data-modal-branch="true"], [data-slot="select-content"], [data-slot="dropdown-menu-content"], [data-slot="dropdown-menu-sub-content"], [data-slot="hover-card-content"]'
    )
  )
}

function getOriginalEventTarget(event: PreventableLayerEvent) {
  const detail = (event as PreventableLayerEvent & {
    detail?: { originalEvent?: { target?: EventTarget | null } }
  }).detail
  return detail?.originalEvent?.target ?? null
}
