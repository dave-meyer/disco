import os
import csv
from typing import List
import zipfile
import pandas as pd
from pathlib import Path

from datasets import load_dataset
from itertools import islice
import shutil
from zipfile import ZipFile

# Configuration variables
NUM_IMAGES_PER_WRITER = 20
NUM_IMAGES_FOR_TESTING = 100
NUM_WRITERS = 10
OUTPUT_DIR = "federated_mnist_data"

BASELINE_DATASET_FILES = [
    "writer_f0000_14.zip",
    "writer_f0001_41.zip",
    "writer_f0002_01.zip",
    "writer_f0003_42.zip",
    "writer_f0004_09.zip",
    "writer_f0005_26.zip",
    "writer_f0006_12.zip",
    "writer_f0007_14.zip",
    "writer_f0008_45.zip",
]

# Load dataset from Hugging Face
def load_federated_mnist():
    print("Loading dataset from Hugging Face...")
    dataset = load_dataset("flwrlabs/femnist", cache_dir=f"./{OUTPUT_DIR}")
    return dataset['train']

def zip_and_delete_folder(folder_path, zip_file_name):
    """
    Zips a folder and deletes the original folder.

    Args:
        folder_path (str): Path to the folder to be zipped.
        zip_file_name (str): Name of the output zip file (without extension).

    Raises:
        FileNotFoundError: If the folder does not exist.
        ValueError: If the folder_path is not a directory.
    """
    if not os.path.exists(folder_path):
        raise FileNotFoundError(f"The folder '{folder_path}' does not exist.")

    if not os.path.isdir(folder_path):
        raise ValueError(f"The path '{folder_path}' is not a directory.")

    zip_path = f"{zip_file_name}.zip"

    # Create a zip file
    with ZipFile(zip_path, 'w') as zipf:
        for root, _, files in os.walk(folder_path):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, start=folder_path)
                zipf.write(file_path, arcname=arcname)

    print(f"Folder '{folder_path}' zipped to '{zip_path}'.")

    # Delete the folder
    shutil.rmtree(folder_path)
    print(f"Folder '{folder_path}' has been deleted.")

# Save images and metadata
def save_writer_data(writer_id, file_suffix, images, labels, output_dir):
    writer_dir = os.path.join(output_dir, f"writer_{writer_id}_{file_suffix}")
    os.makedirs(writer_dir, exist_ok=True)

    img_dir = os.path.join(writer_dir, "img")
    os.makedirs(img_dir, exist_ok=True)

    csv_path = os.path.join(writer_dir, "metadata.csv")
    with open(csv_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["filename", "label"])
        for i, (image, label) in enumerate(zip(images, labels)):
            img_name_without_extension = f"img_{i}"
            img_name = f"{img_name_without_extension}.png"
            img_path = os.path.join(img_dir, img_name)
            image.save(img_path)
            writer.writerow([img_name_without_extension, label])

    zip_and_delete_folder(writer_dir, f"{OUTPUT_DIR}/writer_{writer_id}_{file_suffix}")

# def create_baseline_dataset(datasets: List[str] = BASELINE_DATASET_FILES):
#     """
#     Combines the given datasets to one big dataset.
#     This can be used as a baseline (i.e. how the model would perform if all the data was combined).
#     """
#     baseline_dataset_path = os.path.join(OUTPUT_DIR, "baseline")
#     os.makedirs(baseline_dataset_path, exist_ok=True)
#
#     for dataset in datasets:
#         tmp_dir_path = os.path.join(OUTPUT_DIR, dataset.split(".")[0])
#         with ZipFile(os.path.join(OUTPUT_DIR, dataset), 'r') as zip_ref:
#             zip_ref.extractall(tmp_dir_path)
#
#     zip_and_delete_folder(baseline_dataset_path, f"{OUTPUT_DIR}/baseline")

def combine_federated_mnist(zip_folder, files: [str], output_folder):
    # Create output directories
    output_images_folder = os.path.join(output_folder, "images")
    os.makedirs(output_images_folder, exist_ok=True)
    combined_csv_path = os.path.join(output_folder, "combined_data.csv")

    all_data = []  # To store all rows for the combined CSV

    # Iterate over all zip files
    for zip_file in files:
        zip_path = os.path.join(zip_folder, zip_file)
        zip_name = Path(zip_file).stem

        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Extract all files to a temporary folder
            temp_folder = os.path.join(output_folder, "temp", zip_name)
            os.makedirs(temp_folder, exist_ok=True)
            zf.extractall(temp_folder)

            # Process the img files
            img_files = os.listdir(os.path.join(temp_folder, "img"))
            print("Found", len(img_files), "images")
            for img_file in img_files:
                new_file_name = os.path.join(temp_folder, "img", f"{zip_name}_{img_file}")
                os.rename(os.path.join(temp_folder, "img", img_file), new_file_name)
                shutil.move(new_file_name, )

            # Process the CSV file
            csv_file = next((f for f in os.listdir(temp_folder) if f.endswith(".csv")), None)
            if csv_file:
                csv_path = os.path.join(temp_folder, csv_file)
                df = pd.read_csv(csv_path)

                # Update filenames in the CSV and copy images
                for _, row in df.iterrows():
                    old_img_path = os.path.join(temp_folder, row["filename"])
                    new_img_name = f"{zip_name}_{row['filename']}"
                    new_img_path = os.path.join(output_images_folder, new_img_name)

                    # Move image with updated name
                    if os.path.exists(old_img_path):
                        os.rename(old_img_path, new_img_path)

                    # Update the filename in the dataframe
                    row["filename"] = new_img_name
                    all_data.append(row)

        # # Clean up temporary folder
        # if os.path.exists(temp_folder):
        #     for root, dirs, files in os.walk(temp_folder, topdown=False):
        #         for file in files:
        #             os.remove(os.path.join(root, file))
        #         for dir in dirs:
        #             os.rmdir(os.path.join(root, dir))
        #     os.rmdir(temp_folder)

    # Combine all data into a single CSV
    combined_df = pd.DataFrame(all_data)
    combined_df.to_csv(combined_csv_path, index=False)
    print(f"Combined CSV saved to: {combined_csv_path}")
    print(f"All images saved to: {output_images_folder}")


# Main script
def main():
    # Step 1: Load dataset
    dataset = load_federated_mnist()

    # Step 2: Group data by writer
    print("Processing and saving data...")
    print("Grouping per writer...")
    writer_data = {}
    for sample in dataset:
        writer_id = sample['writer_id']
        image = sample['image']
        label = sample['character']

        if writer_id not in writer_data:
            writer_data[writer_id] = {"images": [], "labels": []}
        writer_data[writer_id]["images"].append(image)
        writer_data[writer_id]["labels"].append(label)

    writer_data = dict(islice(writer_data.items(), NUM_WRITERS))

    print("Grouped per writer!")
    print("Saving data (csv file and ", NUM_IMAGES_PER_WRITER, "images + ", NUM_IMAGES_FOR_TESTING," images for test) for each writer...")
    # Step 3: Save data for each writer
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for writer_id, data in writer_data.items():
        images = data["images"][:NUM_IMAGES_PER_WRITER]
        labels = data["labels"][:NUM_IMAGES_PER_WRITER]
        save_writer_data(writer_id, "test", images, labels, OUTPUT_DIR)

        images = data["images"][NUM_IMAGES_PER_WRITER:(NUM_IMAGES_FOR_TESTING+NUM_IMAGES_PER_WRITER)]
        labels = data["labels"][NUM_IMAGES_PER_WRITER:(NUM_IMAGES_FOR_TESTING+NUM_IMAGES_PER_WRITER)]
        save_writer_data(writer_id, "train", images, labels, OUTPUT_DIR)

    print("Saved data for each writer!")
    print("Data processing complete. Output saved to:", OUTPUT_DIR)

if __name__ == "__main__":
    # main()

    train_files = ["writer_f0000_14_train.zip", "writer_f0001_41_train.zip", "writer_f0002_01_train.zip", "writer_f0003_42_train.zip", "writer_f0004_09_train.zip", "writer_f0005_26_train.zip", "writer_f0006_12_train.zip", "writer_f0007_14_train.zip"]
    test_files = ["writer_f0000_14_test.zip", "writer_f0001_41_test.zip", "writer_f0002_01_test.zip", "writer_f0003_42_test.zip", "writer_f0004_09_test.zip", "writer_f0005_26_test.zip", "writer_f0006_12_test.zip", "writer_f0007_14_test.zip"]
    combine_federated_mnist(OUTPUT_DIR, train_files, OUTPUT_DIR)
