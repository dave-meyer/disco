import os
import csv
from datasets import load_dataset
from itertools import islice
import shutil
from zipfile import ZipFile
from PIL import Image

# Configuration variables
NUM_IMAGES_PER_WRITER = 1000
NUM_WRITERS = 10
OUTPUT_DIR = "federated_mnist_data"

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
def save_writer_data(writer_id, images, labels, output_dir):
    writer_dir = os.path.join(output_dir, f"writer_{writer_id}")
    os.makedirs(writer_dir, exist_ok=True)

    img_dir = os.path.join(writer_dir, "img")
    os.makedirs(img_dir, exist_ok=True)

    csv_path = os.path.join(writer_dir, "metadata.csv")
    with open(csv_path, "w", newline="") as csvfile:
        writer = csv.writer(csvfile)
        writer.writerow(["Image Name", "Label"])
        for i, (image, label) in enumerate(zip(images, labels)):
            img_name = f"img_{i}.png"
            img_path = os.path.join(img_dir, img_name)
            image.save(img_path)
            writer.writerow([img_name, label])

    zip_and_delete_folder(writer_dir, f"{OUTPUT_DIR}/writer_{writer_id}")

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
    print("Saving data for each writer...")
    # Step 3: Save data for each writer
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for writer_id, data in writer_data.items():
        images = data["images"][:NUM_IMAGES_PER_WRITER]
        labels = data["labels"][:NUM_IMAGES_PER_WRITER]
        save_writer_data(writer_id, images, labels, OUTPUT_DIR)

    print("Saved data for each writer!")
    print("Data processing complete. Output saved to:", OUTPUT_DIR)

if __name__ == "__main__":
    main()
