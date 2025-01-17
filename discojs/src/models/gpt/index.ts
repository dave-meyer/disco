/**
 * Source: https://github.com/zemlyansky/gpt-tfjs and https://github.com/karpathy/build-nanogpt
 * With modifications from @peacefulotter, @lukemovement and the Disco team
 **/

import createDebug from "debug";
import { List, Range } from "immutable";
import * as tf from "@tensorflow/tfjs";

import type { Batched, Dataset, DataFormat } from "../../index.js";
import { WeightsContainer } from "../../index.js";

import { BatchLogs, Model, EpochLogs } from "../index.js";

import { GPTModel } from "./model.js";
import evaluate from "./evaluate.js";
import { DefaultGPTConfig, DefaultGenerationConfig } from './config.js'
import type { GPTConfig, GenerationConfig } from './config.js'

const debug = createDebug("discojs:models:gpt");

export type GPTSerialization = {
  weights: WeightsContainer;
  config?: GPTConfig;
};

export class GPT extends Model<"text"> {
  private readonly model: GPTModel;

  readonly #contextLength: number;
  readonly #maxBatchCount: number;
  readonly #vocabSize: number;

  constructor(partialConfig?: Partial<GPTConfig>, layersModel?: tf.LayersModel) {
    super();

    const model = new GPTModel(partialConfig, layersModel);
    model.compile();
    this.model = model;

    this.#contextLength = partialConfig?.contextLength ?? DefaultGPTConfig.contextLength;
    this.#maxBatchCount = partialConfig?.maxIter ?? DefaultGPTConfig.maxIter;
    this.#vocabSize = partialConfig?.vocabSize ?? DefaultGPTConfig.vocabSize;
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
    trainingDataset: Dataset<Batched<DataFormat.ModelEncoded["text"]>>,
    validationDataset?: Dataset<Batched<DataFormat.ModelEncoded["text"]>>,
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

  async #runBatch(
    batch: Batched<DataFormat.ModelEncoded["text"]>,
  ): Promise<BatchLogs> {
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
    dataset: Dataset<Batched<DataFormat.ModelEncoded["text"]>>,
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

  #batchToTF(batch: Batched<DataFormat.ModelEncoded["text"]>): {
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
    batch: Batched<DataFormat.ModelEncoded["text"][0]>,
    options?: Partial<GenerationConfig>,
  ): Promise<Batched<DataFormat.ModelEncoded["text"][1]>> {
    // overwrite default with user config
    const config = Object.assign({}, DefaultGenerationConfig, options)

    return List(
      await Promise.all(
        batch.map((tokens) => this.#predictSingle(tokens, config)),
      ),
    );
  }

  /**
   * Generate the next token after the input sequence.
   * In other words, takes an input tensor of shape (prompt length T) and returns a tensor of shape (T+1)
   * 
   * @param token input tokens of shape (T,). T is truncated to the model's context length
   * @param config generation config: temperature, doSample, topk
   * @returns the next token predicted by the model
   */
  async #predictSingle(
    tokens: DataFormat.ModelEncoded["text"][0],
    config: GenerationConfig,
  ): Promise<DataFormat.ModelEncoded["text"][1]> {
    // slice input tokens if longer than context length
    tokens = tokens.slice(-this.#contextLength);

    const input = tf.tidy(() =>
      tf.tensor1d(tokens.toArray(), "int32").expandDims<tf.Tensor2D>(0),
    );

    const logits = tf.tidy(() => {
      const output = this.model.predict(input);
      if (Array.isArray(output))
        throw new Error("The model outputs too multiple values");
      if (output.rank !== 3) throw new Error("The model outputs wrong shape");
      return output.squeeze<tf.Tensor2D>([0]);
    });
    input.dispose();

    const probs = tf.tidy(() =>
      logits
        .slice([logits.shape[0] - 1])
        .squeeze<tf.Tensor1D>([0])
        .div<tf.Tensor1D>(config.temperature)
        .softmax(),
    );
    logits.dispose();

    const next = tf.tidy(() => {
      if (config.doSample) {
        // returns topk biggest values among the `vocab_size` probabilities and the corresponding tokens indices 
        // both shapes are (config.topk,)
        const { values: topkProbs, indices: topkTokens } = tf.topk(probs, config.topk);
        // sample an index from the top-k probabilities
        // e.g. [[0.1, 0.4, 0.3], [0.1, 0.2, 0.5]] -> [[1], [2]]
        // note: multinomial does not need the input to sum to 1
        const selectedIndices = tf.multinomial(topkProbs, 1, config.seed, false) // (B, )
        // return the corresponding token from the sampled indices (one per sequence in the batch).
        // if for some reason the probabilities are NaN, selectedIndices will be out of bounds
        return topkTokens.gather(selectedIndices).squeeze<tf.Scalar>([0]) // (1)
      } else {
        // greedy decoding: return the token with the highest probability
        return probs.argMax<tf.Scalar>()
      }
    })
    probs.dispose()

    const ret = await next.array();
    next.dispose();
    return ret;
  }

  get config(): Required<GPTConfig> {
    return this.model.getGPTConfig;
  }
  override get weights(): WeightsContainer {
    return new WeightsContainer(this.model.weights.map((w) => w.read()));
  }

  override set weights(ws: WeightsContainer) {
    this.model.setWeights(ws.weights);
  }

  static deserialize(data: GPTSerialization): Model<"text"> {
    const model = new GPT(data.config);
    model.weights = data.weights;
    return model;
  }

  serialize(): GPTSerialization {
    return {
      weights: this.weights,
      config: this.config,
    };
  }
  extract(): tf.LayersModel {
    return this.model;
  }

  [Symbol.dispose](): void {
    if (this.model.optimizer !== undefined) {
      this.model.optimizer.dispose();
    }
    const disposeResults = this.model.dispose();
    if (disposeResults.refCountAfterDispose > 0)
      debug("model not disposed correctly: %o", disposeResults);
  }
}
