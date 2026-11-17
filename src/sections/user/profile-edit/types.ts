export interface ProfileEditRouteData {
  uid: string
  profile: any
  canEdit: boolean
  canDeleteProfile: boolean
  fact: any
  enabled: boolean
  limits: { nicknameForbidden: any }
}
