type GPTModelType =
  | 'gpt2'
  | 'gpt2-medium'
  | 'gpt2-large'
  | 'gpt2-xl'
  | 'gpt-mini'
  | 'gpt-micro'
  | 'gpt-nano'

export interface GPTConfig {
  lr: number
  contextLength: number
  vocabSize?: number
  modelType: GPTModelType
  name?: string,
  evaluate?: boolean
  maxEvalBatches?: number
  evaluateEvery?: number
  maxIter?: number
  weightDecay?: number
  verbose?: 0 | 1
  debug?: boolean
  dropout?: number
  residDrop?: number
  embdDrop?: number
  nLayer?: number
  nHead?: number
  nEmbd?: number
  seed?: number,
}
// for a benchmark of performance, see https://github.com/epfml/disco/pull/659
export const DefaultGPTConfig: Required<GPTConfig> = {
  name: 'transformer', // prefix for the model layer names
  lr: 0.001,
  weightDecay: 0,
  maxIter: 10,
  verbose: 0,
  modelType: 'gpt-nano',
  evaluate: true,
  maxEvalBatches: 12,
  evaluateEvery: 100,
  contextLength: 128,
  vocabSize: 50257,
  debug: false,
  dropout: 0.2,
  residDrop: 0.2,
  embdDrop: 0.2,
  nLayer: 3,
  nHead: 3,
  nEmbd: 48,
  seed: Math.random(),
}

export type ModelSize = {
  nLayer: number
  nHead: number
  nEmbd: number
}

export function getModelSizes (modelType: GPTModelType): Required<ModelSize> {
  switch (modelType) {
    case 'gpt2':
      return { nLayer: 12, nHead: 12, nEmbd: 768 }
    case 'gpt2-medium':
      return { nLayer: 24, nHead: 16, nEmbd: 1024 }
    case 'gpt2-large':
      return { nLayer: 36, nHead: 20, nEmbd: 1280 }
    case 'gpt2-xl':
      return { nLayer: 48, nHead: 25, nEmbd: 1600 }
    case 'gpt-mini':
      return { nLayer: 6, nHead: 6, nEmbd: 192 }
    case 'gpt-micro':
      return { nLayer: 4, nHead: 4, nEmbd: 128 }
    case 'gpt-nano':
      return { nLayer: 3, nHead: 3, nEmbd: 48 }
  }
}

export interface GenerationConfig {
  // take random token weighted by its probability
  // If false, predict the token with the highest probability.
  doSample: boolean
  // the generation temperature (higher means more randomness).
  // Set to 0 for greedy decoding.
  temperature: number
  // only consider the topk most likely tokens for sampling. 
  // used if doSample is true.
  topk: number
  // random seed for sampling.
  seed: number
}

export const DefaultGenerationConfig: Required<GenerationConfig> = {
  temperature: 1.0,
  doSample: false,
  seed: Math.random(),
  topk: 50
}