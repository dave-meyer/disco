/**
 * this code is taken from gpt-tfjs with modifications from @peacefulotter and @lukemovement
 **/

import createDebug from "debug";
import { List, Range } from "immutable";
import * as tf from '@tensorflow/tfjs'
import { PreTrainedTokenizer } from '@xenova/transformers';

import type { Batched, Dataset, ModelEncoded } from "../../index.js";
import { WeightsContainer } from "../../index.js";

import { BatchLogs, Model, EpochLogs } from "../index.js";

import { GPTForCausalLM } from './model.js'
import { DEFAULT_CONFIG, type GPTConfig } from './config.js'
import evaluate from './evaluate.js';

const debug = createDebug("discojs:models:gpt");

export type GPTSerialization = {
  weights: WeightsContainer
  config?: GPTConfig
}

export class GPT extends Model<"text"> {
  private readonly model: GPTForCausalLM

  readonly #maxBatchCount: number
  readonly #vocabSize: number

  constructor (partialConfig?: GPTConfig, layersModel?: tf.LayersModel) {
    super()

    const model = new GPTForCausalLM(partialConfig, layersModel)
    model.compile();
    this.model = model;

    this.#maxBatchCount = partialConfig?.maxIter ?? DEFAULT_CONFIG.maxIter
    this.#vocabSize = partialConfig?.vocabSize ?? DEFAULT_CONFIG.vocabSize
  }

  /**
   * The GPT train methods wraps the model.fitDataset call in a for loop to act as a generator (of logs)
   * This allows for getting logs and stopping training without callbacks.
   *
   * @param trainingData training dataset
   * @param validationData validation dataset
   * @param epochs the number of passes of the training dataset
   * @param tracker
   */
  override async *train(
    trainingDataset: Dataset<Batched<ModelEncoded["text"]>>,
    validationDataset?: Dataset<Batched<ModelEncoded["text"]>>,
  ): AsyncGenerator<BatchLogs, EpochLogs> {
    let batchesLogs = List<BatchLogs>();

    for await (const [batch, _] of trainingDataset.zip(
      Range(0, this.#maxBatchCount),
    )) {
      const batchLogs = await this.#runBatch(batch);

      yield batchLogs;
      batchesLogs = batchesLogs.push(batchLogs);
    }

    const validation =
      validationDataset && (await this.#evaluate(validationDataset));

    return new EpochLogs(batchesLogs, validation);
  }

  async #runBatch(batch: Batched<ModelEncoded["text"]>): Promise<BatchLogs> {
    const tfBatch = this.#batchToTF(batch);

    let logs: tf.Logs | undefined;
    await this.model.fitDataset(tf.data.array([tfBatch]), {
      epochs: 1,
      verbose: 0, // don't pollute
      callbacks: {
        onEpochEnd: (_, cur) => {
          logs = cur;
        },
      },
    });
    tf.dispose(tfBatch);
    if (logs === undefined) throw new Error("batch didn't gave any logs");

    const { loss, acc: accuracy } = logs;
    if (loss === undefined || isNaN(loss))
      throw new Error("training loss is undefined or NaN");

    return {
      accuracy,
      loss,
      memoryUsage: tf.memory().numBytes / 1024 / 1024 / 1024,
    };
  }

  async #evaluate(
    dataset: Dataset<Batched<ModelEncoded["text"]>>,
  ): Promise<Record<"accuracy" | "loss", number>> {
    const evaluation = await evaluate(
      this.model,
      tf.data.generator(
        async function* (this: GPT) {
          yield* dataset.map((batch) => this.#batchToTF(batch));
        }.bind(this),
      ),
      this.config.maxEvalBatches,
    );

    return {
      accuracy: evaluation.val_acc,
      loss: evaluation.val_loss,
    };
  }

  #batchToTF(batch: Batched<ModelEncoded["text"]>): {
    xs: tf.Tensor2D;
    ys: tf.Tensor3D;
  } {
    return tf.tidy(() => ({
      xs: tf.stack(
        batch.map(([line]) => tf.tensor1d(line.toArray(), "int32")).toArray(),
      ) as tf.Tensor2D, // cast as stack doesn't type
      ys: tf.stack(
        batch
          .map(([line, next]) =>
            tf.oneHot(line.shift().push(next).toArray(), this.#vocabSize),
          )
          .toArray(),
      ) as tf.Tensor3D, // cast as oneHot/stack doesn't type
    }));
  }

  override async predict(
    batch: Batched<ModelEncoded["text"][0]>,
  ): Promise<Batched<ModelEncoded["text"][1]>> {
    const predictNext = async (tokens: List<number>) => {
      const generated = await this.model.generate(tokens.toArray(), {
        maxNewTokens: 1,
        temperature: 1.0,
        doSample: false,
      });
      if (generated.length !== 1 && generated[0].length !== 1)
        throw new Error(
          "generation returned many tokens but should have only returned one",
        );

      return generated[0][0];
    };

    return List(await Promise.all(batch.map(predictNext).toArray()))
  }

  /** @deprecated use predict instead and pre/post process the values */
  async generate(input: string, tokenizer: PreTrainedTokenizer, newTokens: number = 10): Promise<string> {
    const { input_ids: tokens } = await tokenizer(input, { return_tensor: false}) as { input_ids: number[] }

    const generationConfig = {
      maxNewTokens: newTokens,
      temperature: 1.0,
      doSample: false
    }
    const predictedTokens = await this.model.generate(tokens, generationConfig)
    const generatedWords = tokenizer.decode(predictedTokens[0])
    return generatedWords
  }

  get config (): Required<GPTConfig> {
    return this.model.getGPTConfig
  }
  override get weights (): WeightsContainer {
    return new WeightsContainer(this.model.weights.map((w) => w.read()))
  }

  override set weights (ws: WeightsContainer) {
    this.model.setWeights(ws.weights)
  }

  static deserialize (data: GPTSerialization): Model<'text'> {
    const model = new GPT(data.config)
    model.weights = data.weights
    return model
  }

  serialize (): GPTSerialization {
    return {
      weights: this.weights,
      config: this.config
    }
  }
  extract (): tf.LayersModel {
    return this.model
  }

  [Symbol.dispose](): void{
    if (this.model.optimizer !== undefined) {
      this.model.optimizer.dispose()
    }
    const disposeResults = this.model.dispose()
    if (disposeResults.refCountAfterDispose > 0)
      debug("model not disposed correctly: %o", disposeResults);
  }
}
