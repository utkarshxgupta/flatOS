import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function suggestRecipes(inventory: string[]) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `I have the following items in my pantry: ${inventory.join(', ')}. Suggest 3 simple meals I can make with these ingredients. Keep the instructions brief and WhatsApp-friendly so I can forward them to my cook.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              ingredientsToUse: { type: Type.ARRAY, items: { type: Type.STRING } },
              instructions: { type: Type.STRING }
            },
            required: ["name", "ingredientsToUse", "instructions"]
          }
        }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No response from Gemini");
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error suggesting recipes:", error);
    throw error;
  }
}
export async function parseSplitwiseScreenshot(base64Image: string, mimeType: string) {
  try {
    const imagePart = {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    };
    
    const textPart = {
      text: "Analyze this screenshot from Splitwise (or similar expense sharing app). Extract the names of all the people listed. Then, calculate the settlement plan: who owes whom and how much. For the settlement plan, 'payer' is the person who is owed money (they 'get back' money), and 'borrower' is the person who owes money. Try to balance the 'owes' and 'gets back' amounts to create a list of direct debts.",
    };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [imagePart, textPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            personas: { 
              type: Type.ARRAY, 
              items: { type: Type.STRING },
              description: "List of all names found in the screenshot"
            },
            debts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  payer: { type: Type.STRING, description: "The person who gets back money" },
                  borrower: { type: Type.STRING, description: "The person who owes money" },
                  amount: { type: Type.NUMBER, description: "The exact amount owed" }
                },
                required: ["payer", "borrower", "amount"]
              }
            }
          },
          required: ["personas", "debts"]
        }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No response from Gemini");
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error parsing Splitwise screenshot:", error);
    throw error;
  }
}

export async function parseReceipt(images: {base64Image: string, mimeType: string}[]) {
  try {
    const imageParts = images.map(img => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Image,
      },
    }));
    
    const textPart = {
      text: "Analyze these receipts from a quick-commerce app (like Zepto, Blinkit, Swiggy Instamart) OR a food delivery app (like Swiggy, Zomato). Extract the merchant name (e.g., 'Zepto', 'Blinkit', 'Swiggy', 'Zomato'). Extract the line items, their quantities, and their total prices. Also extract the combined total amount of the receipts. If you can determine the category (e.g., Groceries, Snacks, Utilities, Restaurant Food), include that too. For grocery items, fetch the quantity as a string including the weight/volume and count (e.g., '400 g x 1', '120 g x 2', '450 ml x 1') so that inventory management is accurate. Also, determine if the item is a grocery/pantry item (isGrocery: true) or if it is prepared food for immediate consumption from a restaurant (isGrocery: false).",
    };

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: [...imageParts, textPart] },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchantName: { type: Type.STRING, description: "Name of the merchant or app (e.g., Zepto, Blinkit, Swiggy, Zomato)" },
            totalAmount: { type: Type.NUMBER, description: "Total amount on the receipt" },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Name of the item" },
                  quantity: { type: Type.STRING, description: "Quantity purchased, including weight/volume and count if available (e.g., '400 g x 1', '2', '500 ml')" },
                  price: { type: Type.NUMBER, description: "Total price for this line item" },
                  category: { type: Type.STRING, description: "Category like Groceries, Snacks, Cleaning, Restaurant Food, etc." },
                  healthTag: { type: Type.STRING, description: "If food, flag as 'High Sugar', 'Fresh Produce', 'Refined Oils', etc. Otherwise leave empty." },
                  isGrocery: { type: Type.BOOLEAN, description: "True if this is a grocery/pantry item, false if it is prepared food from a restaurant for immediate consumption" }
                },
                required: ["name", "quantity", "price", "category", "isGrocery"]
              }
            }
          },
          required: ["totalAmount", "items"]
        }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No response from Gemini");
    
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error parsing receipt:", error);
    throw error;
  }
}
