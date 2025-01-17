<template>
  <div v-if="task !== undefined">
    <Description v-show="trainingStore.step === 1" :task="task" />

    <div
      v-show="trainingStore.step === 2"
      class="flex flex-col space-y-4 md:space-y-8"
    >
      <LabeledDatasetInput :task v-model="dataset">
        <template #header>
          <DataDescription :task />
        </template>
      </LabeledDatasetInput>
    </div>

    <Trainer
      v-show="trainingStore.step === 3"
      :task
      :dataset="unamedDataset"
      @model="(m) => (trainedModel = m)"
    />

    <Finished v-show="trainingStore.step === 4" :task :model="trainedModel" />
  </div>
  <TrainingButtons />
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, toRaw, watch } from "vue";
import { useRouter, useRoute } from "vue-router";

import type {
  Dataset,
  DataFormat,
  DataType,
  Model,
  Task,
  TaskID,
} from "@epfml/discojs";

import type { LabeledDataset } from "@/components/dataset_input/types.js";
import DataDescription from "@/components/dataset_input/DataDescription.vue";
import LabeledDatasetInput from "@/components/dataset_input/LabeledDatasetInput.vue";
import TrainingButtons from "@/components/progress_bars/TrainingButtons.vue";
import Description from "@/components/training/Description.vue";
import Finished from "@/components/training/Finished.vue";
import Trainer from "@/components/training/Trainer.vue";
import { useTasksStore, useTrainingStore } from "@/store";

const router = useRouter();
const route = useRoute();
const trainingStore = useTrainingStore();
const tasksStore = useTasksStore();

// task ID given by the route
const props = defineProps<{
  id: TaskID;
}>();

function setupTrainingStore() {
  trainingStore.setTask(route.params.id as string); // more reliable than props.id
  trainingStore.setStep(1);
}
// Init the task once the taskStore has been loaded successfully
// If it is not we redirect to the task list
const task = computed<Task<DataType> | undefined>(() => {
  if (tasksStore.status == "success") {
    return tasksStore.tasks.get(props.id);
  }
  // Redirect to the task list if not loaded yet
  // This happens when refreshing the page, every task are reset when fetched
  if (route.name !== "task-list") {
    router.replace({ name: "task-list" });
  }
  return undefined;
});

// Addresses the case when users enter a url manually
// Force the training store to synch with the task specified in the url
// Watching route.fullPath triggers onMount (while route.name would not)
watch(
  () => route.fullPath,
  () => {
    if (route.params.id === undefined) return; // don't do anything if not on a task page
    if (trainingStore.step !== 0 && route.params.id === props.id) return; // check that params are consistent
    setupTrainingStore(); // if inconsistent, force sync the training store
  },
);

onMounted(setupTrainingStore);

const dataset = ref<LabeledDataset[DataType]>();
const unamedDataset = computed<Dataset<DataFormat.Raw[DataType]> | undefined>(
  () => {
    if (task.value === undefined || dataset.value === undefined)
      return undefined;

    switch (task.value.trainingInformation.dataType) {
      case "image":
        return (toRaw(dataset.value) as LabeledDataset["image"]).map(
          ({ image, label }) => [image, label],
        ) as Dataset<DataFormat.Raw["image"]>;
      case "tabular":
      case "text":
        return dataset.value as Dataset<DataFormat.Raw["tabular" | "text"]>;
      default: {
        const _: never = task.value.trainingInformation;
        throw new Error("should never happen");
      }
    }
  },
);
const trainedModel = ref<Model<DataType>>();
</script>
