import { Seq } from "immutable";

import type {
  DataType,
  Task,
  TaskProvider,
  TrainingInformation,
} from "@epfml/discojs";
import { isTask, serialization } from "@epfml/discojs";

export function setupServerWith(
  ...providers: (Task<DataType> | TaskProvider<DataType>)[]
): void {
  const tasksAndModels = Seq(providers).map((p) => {
    if (isTask(p)) return [p, undefined] as const;
    return [p.getTask(), p.getModel()] as const;
  });

  cy.intercept(
    { hostname: "server", pathname: "tasks" },
    tasksAndModels.map(([t]) => t).toArray(),
  );

  tasksAndModels.forEach(([task, model]) => {
    if (model === undefined) return;

    // cypress really wants to JSON encode our buffer.
    // to avoid that, we are replacing it directly in the response
    cy.intercept(
      { hostname: "server", pathname: `/tasks/${task.id}/model.json` },
      { statusCode: 200 },
    );
    cy.wrap<Promise<serialization.Encoded>, serialization.Encoded>(
      model.then(serialization.model.encode),
    ).then((encoded) =>
      cy.intercept(
        { hostname: "server", pathname: `/tasks/${task.id}/model.json` },
        (req) =>
          req.on("response", (res) => {
            res.body = encoded;
          }),
      ),
    );
  });
}

type BasicKeys =
  | "epochs"
  | "batchSize"
  | "roundDuration"
  | "validationSplit"
  | "tensorBackend"
  | "scheme"
  | "minNbOfParticipants";
export function basicTask<D extends DataType>(
  info: {
    [K in DataType]: Omit<TrainingInformation<K>, BasicKeys> &
      Partial<Pick<TrainingInformation<K>, BasicKeys>>;
  }[D],
): Task<D> {
  return {
    id: "task",
    trainingInformation: {
      epochs: 1,
      batchSize: 1,
      roundDuration: 1,
      validationSplit: 1,
      tensorBackend: "tfjs",
      scheme: "local",
      minNbOfParticipants: 1,
      ...info,
    },
    displayInformation: {
      taskTitle: "task",
      summary: { preview: "preview", overview: "overview" },
    },
  };
}

beforeEach(() =>
  navigator.storage
    .getDirectory()
    .then((root) => root.removeEntry("models", { recursive: true })),
);
