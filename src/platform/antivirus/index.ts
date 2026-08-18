import 'server-only'

export {
  virusScanner,
  ClamAvScanner,
  NoopScanner,
  __setVirusScanner,
  type VirusScanner,
  type ScanVerdict,
} from './scanner'
