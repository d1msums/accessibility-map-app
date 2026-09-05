// Shared: browser geolocation helper used by both MapView and ReportForm.
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject)
  })
}
