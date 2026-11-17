export interface UserAuthRouteData {
  enabled: boolean
  challenge: any
  next: string | null
  step: string
  registerSeed: string | null
  limits: { nicknameForbidden: any; holdSeconds: any }
}
