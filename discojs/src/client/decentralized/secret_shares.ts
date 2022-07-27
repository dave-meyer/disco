import { List } from 'immutable'

import * as tf from '@tensorflow/tfjs'
import * as crypto from 'crypto'

import { Weights } from '../..'

export function subtractWeights (w1: Weights, w2: Weights): Weights {
  ''
  'Return Weights object that is difference of two weights objects'
  ''
  if (w1.length !== w2.length) {
    throw new Error('weights not of the same lenght')
  }

  const sub: Weights = []
  for (let i = 0; i < w1.length; i++) {
    sub.push(tf.sub(w1[i], w2[i]))
  } return sub
}

export function sum (setSummands: List<Weights>): Weights { // need to test
  ''
  'Return sum of multiple weight objects in an array, returns weight object of sum'
  ''
  if (setSummands.size < 1) {
    return []
  }
  const summedWeights: Weights = new Array<tf.Tensor>()
  let tensors: Weights = new Array<tf.Tensor>() // list of different sized tensors of 0
  // @ts-expect-error
  for (let j = 0; j < setSummands.get(0).length; j++) {
    for (let i = 0; i < setSummands.size; i++) {
      // @ts-expect-error
      tensors.push(setSummands.get(i)[j])
    }
    summedWeights.push(tf.addN(tensors))
    tensors = new Array<tf.Tensor>()
  }
  return summedWeights
}

export function lastShare (currentShares: Weights[], secret: Weights): Weights {
  ''
  'Return Weights in the remaining share once N-1 shares have been constructed, where N are the amount of participants'
  ''
  const currentShares2 = List<Weights>(currentShares)
  const last: Weights = subtractWeights(secret, sum(currentShares2))
  return last
}

export function generateAllShares (secret: Weights, nParticipants: number, noiseMagnitude: number): List<Weights> {
  ''
  'Generate N additive shares that aggregate to the secret array'
  ''
  const shares: Weights[] = []
  for (let i = 0; i < nParticipants - 1; i++) {
    shares.push(generateRandomShare(secret, noiseMagnitude))
  }
  shares.push(lastShare(shares, secret))
  const sharesFinal = List<Weights>(shares)
  return sharesFinal
}

export function generateRandomNumber (noiseMagnitude: number): number {
  return crypto.randomInt(noiseMagnitude)
}

export function generateRandomShare (secret: Weights, maxShareValue: number): Weights {
  const share: Weights = []
  for (const t of secret) {
    share.push(
      tf.randomUniform(
        t.shape, -maxShareValue, maxShareValue, undefined, generateRandomNumber(maxShareValue))
    )
  }
  return share
}
