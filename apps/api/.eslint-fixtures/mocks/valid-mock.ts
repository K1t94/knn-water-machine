export async function invokeMock(context: any): Promise<void> {
    await Promise.resolve();
    console.log(context);
}
