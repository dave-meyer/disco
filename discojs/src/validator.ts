import type { Dataset, DataFormat, DataType, Model, Task } from "./index.js";
import { processing } from "./index.js";

export class Validator<D extends DataType> {
  readonly #model: Model<D>;

  constructor(
    public readonly task: Task<D>,
    model: Model<D>,
  ) {
    this.#model = model;
  }

  /** infer every line of the dataset and check that it is as labelled */
  async *test(
    dataset: Dataset<DataFormat.Raw[D]>,
  ): AsyncGenerator<boolean, void> {
    const results = (await processing.preprocess(this.task, dataset))
      .batch(this.task.trainingInformation.batchSize)
      .map(async (batch) =>
        (await this.#model.predict(batch.map(([inputs, _]) => inputs)))
          .zip(batch.map(([_, outputs]) => outputs))
          .map(([inferred, truth]) => inferred === truth),
      )
      .flatten();

    for await (const e of results) yield e;
  }

  /** use the model to predict every line of the dataset */
  async *infer(
    dataset: Dataset<DataFormat.RawWithoutLabel[D]>,
  ): AsyncGenerator<DataFormat.Inferred[D], void> {
    const modelPredictions = (
      await processing.preprocessWithoutLabel(this.task, dataset)
    )
      .batch(this.task.trainingInformation.batchSize)
      .map((batch) => this.#model.predict(batch))
      .flatten();

    const predictions = await processing.postprocess(
      this.task,
      modelPredictions,
    );

    for await (const e of predictions) yield e;
  }
}
